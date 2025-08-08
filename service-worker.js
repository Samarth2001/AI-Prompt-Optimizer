import { secureStorageService } from "./services/secure-storage-service.js";
import { validationService } from "./services/validation-service.js";

const ALLOWED_ACTIONS = new Set(["getUsage", "enhancePrompt", "unlockPassphrase", "lockPassphrase"]);
const MIN_ENHANCE_INTERVAL_MS = 3000; // 1 req / 3s
let lastEnhanceAt = 0;
const MAX_PROMPT_CHARS = 4000;
const DEFAULT_MODEL = "google/gemini-2.0-flash-exp:free";
const APP_X_TITLE = "Enhance Prompt";

const ALLOWED_HOSTS = [
  "claude.ai",
  "chat.openai.com",
  "chatgpt.com",
  "gemini.google.com",
  "grok.com",
];

function isTrustedSender(sender) {
  try {
    if (!sender) return false;
    if (sender.id && sender.id !== chrome.runtime.id) return false;
    if (sender.id === chrome.runtime.id) return true;
    const urlString = sender.url || "";
    if (urlString.startsWith("chrome-extension://")) return true;
    if (!urlString) return false;
    const url = new URL(urlString);
    const host = url.hostname || "";
    return ALLOWED_HOSTS.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`)
    );
  } catch (_) {
    return false;
  }
}

const APP_HTTP_REFERER =
  (chrome.runtime.getManifest && chrome.runtime.getManifest().homepage_url) ||
  "https://enhance-prompt-api.prompt-enhance-api.workers.dev";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithRetry(url, options = {}, attempts = 3, timeoutMs = 15000, backoffBaseMs = 300) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetchWithTimeout(url, options, timeoutMs);
      return response;
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        const backoff = backoffBaseMs * Math.pow(2, attempt - 1);
        await delay(backoff);
        continue;
      }
    }
  }
  throw lastError || new Error("Request failed");
}

async function getOrCreateUserToken() {
  let token = await secureStorageService.retrieve("userToken");
  if (!token) {
    token = crypto.randomUUID();
    await secureStorageService.save("userToken", token);
  }
  return token;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!isTrustedSender(sender)) {
    sendResponse({ success: false, error: "Unauthorized sender" });
    return false;
  }

  if (!request || typeof request.action !== "string" || !ALLOWED_ACTIONS.has(request.action)) {
    sendResponse({ success: false, error: "Action not allowed" });
    return false;
  }

  if (request.action === "getUsage") {
    (async () => {
      const userToken = await getOrCreateUserToken();
      const ip = "not-collected"; // IP is handled server-side
      const rateLimitKey = `rate_limit:${userToken}:${ip}`;
      const usage = await secureStorageService.retrieve(rateLimitKey);
      sendResponse(usage || { count: 0 });
    })();
    return true;
  }

  if (request.action === "unlockPassphrase") {
    (async () => {
      try {
        const pass = (request && request.passphrase) || "";
        if (!pass || typeof pass !== "string") {
          throw new Error("Passphrase required");
        }
        await secureStorageService.unlockWithPassphrase(pass);
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.action === "lockPassphrase") {
    try {
      secureStorageService.disablePassphraseMode();
      sendResponse({ success: true });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return false;
  }

  if (request.action === "enhancePrompt") {
    (async () => {
      const now = Date.now();
      const elapsed = now - lastEnhanceAt;
      if (elapsed < MIN_ENHANCE_INTERVAL_MS) {
        const waitMs = MIN_ENHANCE_INTERVAL_MS - elapsed;
        const waitSec = Math.ceil(waitMs / 1000);
        sendResponse({ success: false, error: `Too many requests. Please wait ${waitSec}s and try again.` });
        return;
      }
      lastEnhanceAt = now;

      const { mode } = await chrome.storage.local.get("mode");
      if (mode === "byok") {
        await handleByokRequest(request, sendResponse);
      } else {
        await handleProxyRequest(request, sendResponse);
      }
    })();
    return true;
  }
});

async function handleProxyRequest({ prompt }, sendResponse) {
  try {
    const userToken = await getOrCreateUserToken();
    const basePrompt = validationService.sanitizeInput((prompt || "").trim());
    if (!basePrompt) {
      throw new Error("Prompt is empty.");
    }
    if (basePrompt.length > MAX_PROMPT_CHARS) {
      throw new Error(`Prompt exceeds ${MAX_PROMPT_CHARS} characters.`);
    }
    const sanitizedPrompt = basePrompt;
    const apiUrl =
      "https://enhance-prompt-api.prompt-enhance-api.workers.dev/api/enhance";

    const response = await fetchWithRetry(
      apiUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Token": userToken,
        },
        body: JSON.stringify({
          messages: [
            {
              role: "system",
              content: `You are a pragmatic prompt optimizer. Rewrite the user's prompt so an AI can produce exactly what they want.

Directives:
- Preserve the user's intent, constraints, domain terms, code, and any quoted text. Do not change the ask.
- Keep the original language and tone; if unclear, default to neutral and professional.
- Do not overengineer. Be concise and focused; avoid redundancy.
- If essential context is missing (purpose, audience, format, length, success criteria, key constraints), add only the minimal helpful details to remove ambiguity. Use reasonable defaults; avoid speculation.
- When the request is vague, clarify the objective in one short sentence, then specify deliverable, must-have content, and constraints succinctly.
- Never include meta commentary, explanations, labels, or special tokens (e.g., <think>). Do not use markdown fences, headings, or quotes.
- Output only the enhanced prompt, ready to send to a model.

Return only the enhanced prompt.`,
            },
            { role: "user", content: sanitizedPrompt },
          ],
        }),
      },
      3,
      15000,
      300
    );

    const usageCount = response.headers.get("X-Usage-Count");
    if (usageCount) {
      const rateLimitKey = `rate_limit:${userToken}:not-collected`;
      await secureStorageService.save(rateLimitKey, {
        count: parseInt(usageCount, 10),
      });
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message = errorData?.message || errorData?.error || `Proxy service error: ${response.status}`;
      throw new Error(message);
    }

    const data = await response.json();
    if (data.choices && data.choices[0]) {
      sendResponse({
        success: true,
        enhancedPrompt: data.choices[0].message.content.trim(),
      });
    } else {
      throw new Error("Invalid response from proxy.");
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}

async function handleByokRequest({ prompt }, sendResponse) {
  try {
    const apiKey = await secureStorageService.retrieve("byokApiKey");
    if (!apiKey) {
      throw new Error("API key not set for BYOK mode.");
    }

    const basePrompt = validationService.sanitizeInput((prompt || "").trim());
    if (!basePrompt) {
      throw new Error("Prompt is empty.");
    }
    if (basePrompt.length > MAX_PROMPT_CHARS) {
      throw new Error(`Prompt exceeds ${MAX_PROMPT_CHARS} characters.`);
    }
    const sanitizedPrompt = basePrompt;
    const response = await fetchWithRetry(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "HTTP-Referer": APP_HTTP_REFERER,
          "X-Title": APP_X_TITLE,
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages: [
            {
              role: "system",
              content: `You are a pragmatic prompt optimizer. Rewrite the user's prompt so an AI can produce exactly what they want.

Directives:
- Preserve the user's intent, constraints, domain terms, code, and any quoted text. Do not change the ask.
- Keep the original language and tone; if unclear, default to neutral and professional.
- Do not overengineer. Be concise and focused; avoid redundancy.
- If essential context is missing (purpose, audience, format, length, success criteria, key constraints), add only the minimal helpful details to remove ambiguity. Use reasonable defaults; avoid speculation.
- When the request is vague, clarify the objective in one short sentence, then specify deliverable, must-have content, and constraints succinctly.
- Never include meta commentary, explanations, labels, or special tokens (e.g., <think>). Do not use markdown fences, headings, or quotes.
- Output only the enhanced prompt, ready to send to a model.

Return only the enhanced prompt.`,
            },
            { role: "user", content: sanitizedPrompt },
          ],
        }),
      },
      2,
      15000,
      500
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error?.message || `OpenRouter API error: ${response.status}`
      );
    }

    const data = await response.json();
    if (data.choices && data.choices[0]) {
      sendResponse({
        success: true,
        enhancedPrompt: data.choices[0].message.content.trim(),
      });
    } else {
      throw new Error("Invalid response from OpenRouter.");
    }
  } catch (error) {
    sendResponse({ success: false, error: error.message });
  }
}
