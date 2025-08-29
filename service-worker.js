import { secureStorageService } from "./services/secure-storage-service.js";
import { validationService } from "./services/validation-service.js";

const ALLOWED_ACTIONS = new Set([
  "getUsage",
  "enhancePrompt",
  "unlockPassphrase",
  "lockPassphrase",
  "ensureValidJwt",
  "_debugSetRateLimit",  
  "updateRemoteConfig",
  "turnstileToken",
  "turnstileCanceled",
]);

const DEFAULTS = {
  MIN_ENHANCE_INTERVAL_MS: 3000,
  MAX_PROMPT_CHARS: 4000,
  DEFAULT_MODEL: "google/gemini-2.0-flash-exp:free",
  ALLOWED_HOSTS: [
    "claude.ai",
    "chat.openai.com",
    "chatgpt.com",
    "gemini.google.com",
    "grok.com",
  ],
  RATE_LIMIT_PER_DAY: 100,
};

let lastEnhanceAt = 0;
const APP_X_TITLE = "Enhance Prompt";

let ALLOWED_HOSTS_CACHE = DEFAULTS.ALLOWED_HOSTS.slice();

async function getConfig(key) {
  const config = await secureStorageService.retrieve("remote_config");
  return config?.[key] ?? DEFAULTS[key];
}

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
    return ALLOWED_HOSTS_CACHE.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`)
    );
  } catch (_) {
    return false;
  }
}

const APP_HTTP_REFERER =
  (chrome.runtime.getManifest && chrome.runtime.getManifest().homepage_url) ||
  "https://prompt-enhancer-worker.prompt-enhance-api.workers.dev";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchWithRetry(
  url,
  options = {},
  attempts = 3,
  timeoutMs = 15000,
  backoffBaseMs = 300
) {
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

async function ensureValidJwt() {
  const sessionData = await chrome.storage.session.get("jwt");
  let token = sessionData && sessionData.jwt;
  if (token) {
    const payload = decodeJwt(token);
    if (payload && payload.exp * 1000 > Date.now() + 60 * 1000) {
      return token;
    }
  }

  let turnstileToken = "";
  try {
    turnstileToken = await getTurnstileTokenViaOverlay();
  } catch (_) {
    const redirectUrl = await chrome.identity.getRedirectURL();
    const authUrl = `https://prompt-enhancer-worker.prompt-enhance-api.workers.dev/turnstile?redirect_uri=${encodeURIComponent(
      redirectUrl
    )}`;
    const resultUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl, interactive: true },
        (responseUrl) => {
          if (chrome.runtime.lastError || !responseUrl) {
            reject(chrome.runtime.lastError || new Error("Verification failed"));
            return;
          }
          resolve(responseUrl);
        }
      );
    });

    const tokenMatch = String(resultUrl).match(/[#&]token=([^&]+)/);
    turnstileToken = tokenMatch ? decodeURIComponent(tokenMatch[1]) : "";
    if (!turnstileToken)
      throw new Error("Turnstile verification failed: no token");
  }

  const apiUrl =
    "https://prompt-enhancer-worker.prompt-enhance-api.workers.dev/api/token";
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnstileToken }),
  });
  if (!response.ok)
    throw new Error("Failed to exchange Turnstile token for JWT");

  const data = await response.json();
  await chrome.storage.session.set({ jwt: data.token });
  return data.token;
}

async function getTurnstileTokenViaOverlay() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) throw new Error("No active tab");
  const embedUrl = "https://prompt-enhancer-worker.prompt-enhance-api.workers.dev/turnstile-embed";

  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      if (done) return;
      done = true;
      chrome.runtime.onMessage.removeListener(onMsg);
      reject(new Error("Turnstile overlay timeout"));
    }, 60000);

    function finish(ok, payload) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(onMsg);
      if (ok) resolve(payload);
      else reject(new Error(payload || "Turnstile canceled"));
    }

    function onMsg(request, sender, sendResponse) {
      if (!isTrustedSender(sender)) return false;
      if (request && request.action === "turnstileToken" && request.token) {
        sendResponse({ ok: true });
        finish(true, String(request.token));
        return true;
      }
      if (request && request.action === "turnstileCanceled") {
        sendResponse({ ok: true });
        finish(false, request.reason);
        return true;
      }
      return false;
    }

    chrome.runtime.onMessage.addListener(onMsg);
    chrome.tabs.sendMessage(tab.id, { action: "startTurnstileOverlay", embedUrl }, () => {});
  });
}

function decodeJwt(token) {
  try {
    const [, payload] = token.split(".");
    const decoded = atob(payload);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

async function getOrCreateJwt() {
  const sessionData = await chrome.storage.session.get("jwt");
  let token = sessionData && sessionData.jwt;
  const payload = token ? decodeJwt(token) : null;

  if (!payload || payload.exp * 1000 < Date.now() + 60 * 1000) {
    try {
      token = await ensureValidJwt();
    } catch (error) {
      throw new Error(
        `Security check failed: ${error.message}. Please try opening the popup again.`
      );
    }
  }

  if (!token) {
    throw new Error(
      "Could not get security token. Please open the popup to try again."
    );
  }

  return token;
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if (!(await isTrustedSender(sender))) {
      sendResponse({ success: false, error: "Unauthorized sender" });
      return;
    }

    if (
      !request ||
      typeof request.action !== "string" ||
      !ALLOWED_ACTIONS.has(request.action)
    ) {
      sendResponse({ success: false, error: "Action not allowed" });
      return;
    }

    if (request.action === "ensureValidJwt") {
      try {
        await ensureValidJwt();
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return;
    }

    if (request.action === "getUsage") {
      const rateLimitKey = `rate_limit_status`;
      const usage = await secureStorageService.retrieve(rateLimitKey);

      if (
        usage &&
        typeof usage.limit === "number" &&
        typeof usage.remaining === "number"
      ) {
        sendResponse(usage);
      } else {
        const limit = await getConfig("RATE_LIMIT_PER_DAY");
        sendResponse({ limit: limit, remaining: limit, reset: 0 });
      }
      return;
    }

    if (request.action === "updateRemoteConfig") {
      try {
        await updateRemoteConfig();
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return;
    }

    if (request.action === "_debugSetRateLimit") {
      try {
        const rateLimitKey = `rate_limit_status`;
        const limit = await getConfig("RATE_LIMIT_PER_DAY");
        const usage = (await secureStorageService.retrieve(rateLimitKey)) || {
          limit: limit,
          remaining: limit,
        };
        const newRemaining = request.remaining;

        if (typeof newRemaining !== "number") {
          throw new Error("Invalid remaining value for debug set.");
        }

        usage.remaining = newRemaining;
        await secureStorageService.save(rateLimitKey, usage);
        sendResponse({ success: true, usage: usage });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return;
    }

    if (request.action === "unlockPassphrase") {
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
      return;
    }

    if (request.action === "lockPassphrase") {
      try {
        secureStorageService.disablePassphraseMode();
        sendResponse({ success: true });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
      return;
    }

    if (request.action === "enhancePrompt") {
      const now = Date.now();
      const elapsed = now - lastEnhanceAt;
      const minInterval = await getConfig("MIN_ENHANCE_INTERVAL_MS");
      if (elapsed < minInterval) {
        const waitMs = minInterval - elapsed;
        const waitSec = Math.ceil(waitMs / 1000);
        sendResponse({
          success: false,
          error: `Too many requests. Please wait ${waitSec}s and try again.`,
        });
        return;
      }
      lastEnhanceAt = now;

      const { mode } = await chrome.storage.local.get("mode");
      if (mode === "byok") {
        await handleByokRequest(request, sendResponse);
      } else {
        await handleProxyRequest(request, sendResponse);
      }
    }
  })();
  return true;
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install" || details.reason === "update") {
    await updateRemoteConfig();
  }
});

async function updateRemoteConfig() {
  try {
    const configUrl =
      "https://prompt-enhancer-worker.prompt-enhance-api.workers.dev/api/config";
    const response = await fetch(configUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch remote config: ${response.status}`);
    }
    const config = await response.json();

    const newConfig = {
      rateLimitPerDay:
        config.rateLimitPerDay ?? DEFAULTS.RATE_LIMIT_PER_DAY,
      maxPromptChars: config.maxPromptChars ?? DEFAULTS.MAX_PROMPT_CHARS,
      defaultModel: config.defaultModel ?? DEFAULTS.DEFAULT_MODEL,
      allowedHosts: config.allowedHosts ?? DEFAULTS.ALLOWED_HOSTS,
      minEnhanceIntervalMs:
        config.minEnhanceIntervalMs ?? DEFAULTS.MIN_ENHANCE_INTERVAL_MS,
    };

    await secureStorageService.save("remote_config", newConfig);
    if (Array.isArray(newConfig.allowedHosts) && newConfig.allowedHosts.length) {
      ALLOWED_HOSTS_CACHE = newConfig.allowedHosts.slice();
    }
  } catch (error) {
    console.error("Could not update remote configuration:", error);
    // Fallback to ensure defaults are set if fetch fails
    const currentConfig = await secureStorageService.retrieve("remote_config");
    if (!currentConfig) {
      await secureStorageService.save("remote_config", {
        rateLimitPerDay: DEFAULTS.RATE_LIMIT_PER_DAY,
        maxPromptChars: DEFAULTS.MAX_PROMPT_CHARS,
        defaultModel: DEFAULTS.DEFAULT_MODEL,
        allowedHosts: DEFAULTS.ALLOWED_HOSTS,
        minEnhanceIntervalMs: DEFAULTS.MIN_ENHANCE_INTERVAL_MS,
      });
      ALLOWED_HOSTS_CACHE = DEFAULTS.ALLOWED_HOSTS.slice();
    }
  }
}

async function handleProxyRequest({ prompt }, sendResponse) {
  try {
    const jwt = await getOrCreateJwt();
    const basePrompt = validationService.sanitizeInput((prompt || "").trim());
    if (!basePrompt) {
      throw new Error("Prompt is empty.");
    }
    const maxPromptChars = await getConfig("MAX_PROMPT_CHARS");
    if (basePrompt.length > maxPromptChars) {
      throw new Error(`Prompt exceeds ${maxPromptChars} characters.`);
    }
    const sanitizedPrompt = basePrompt;
    const apiUrl =
      "https://prompt-enhancer-worker.prompt-enhance-api.workers.dev/api/enhance";

    const response = await fetchWithRetry(
      apiUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: sanitizedPrompt }],
        }),
      },
      3,
      15000,
      300
    );

    const limit = response.headers.get("X-RateLimit-Limit");
    const remaining = response.headers.get("X-RateLimit-Remaining");
    const reset = response.headers.get("X-RateLimit-Reset");
    const usageCount = response.headers.get("X-Usage-Count");

     if (
      limit !== null ||
      remaining !== null ||
      reset !== null ||
      usageCount !== null
    ) {
      const rateLimitKey = `rate_limit_status`;

      const currentUsage = (await secureStorageService.retrieve(
        rateLimitKey
      )) || { limit: 100, remaining: 100, reset: 0, count: 0 };

      const parsedLimit = parseInt(limit, 10);
      const parsedRemaining = parseInt(remaining, 10);
      const parsedReset = parseInt(reset, 10);
      const parsedCount = parseInt(usageCount, 10);

      const effectiveLimit = !isNaN(parsedLimit)
        ? parsedLimit
        : currentUsage.limit;
      const effectiveCount = !isNaN(parsedCount)
        ? parsedCount
        : currentUsage.count;
      const derivedRemaining = !isNaN(parsedRemaining)
        ? parsedRemaining
        : Math.max(0, effectiveLimit - effectiveCount);

      const newUsage = {
        limit: effectiveLimit,
        remaining: derivedRemaining,
        reset: !isNaN(parsedReset) ? parsedReset : currentUsage.reset,
        count: effectiveCount,
      };

      await secureStorageService.save(rateLimitKey, newUsage);

      try {
        // Use the same robust object for the UI update message
        await chrome.runtime.sendMessage({
          action: "rateLimitUpdate",
          usage: newUsage,
        });
      } catch (_) {}
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message =
        errorData?.message ||
        errorData?.error ||
        `Proxy service error: ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.data = { code: errorData?.code };
      throw error;
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
    sendResponse({
      success: false,
      error: {
        message: error.message,
        status: error.status,
        data: error.data,
      },
    });
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
    const maxPromptChars = await getConfig("MAX_PROMPT_CHARS");
    if (basePrompt.length > maxPromptChars) {
      throw new Error(`Prompt exceeds ${maxPromptChars} characters.`);
    }
    const sanitizedPrompt = basePrompt;

    const jwt = await getOrCreateJwt();
    const apiUrl =
      "https://prompt-enhancer-worker.prompt-enhance-api.workers.dev/api/enhance/byok";

    const response = await fetchWithRetry(
      apiUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
        },
        body: JSON.stringify({
          byokKey: apiKey,
          messages: [{ role: "user", content: sanitizedPrompt }],
        }),
      },
      2,
      15000,
      500
    );

    const limit = response.headers.get("X-RateLimit-Limit");
    const remaining = response.headers.get("X-RateLimit-Remaining");
    const reset = response.headers.get("X-RateLimit-Reset");
    const usageCount = response.headers.get("X-Usage-Count");

    if (
      limit !== null ||
      remaining !== null ||
      reset !== null ||
      usageCount !== null
    ) {
      const rateLimitKey = `rate_limit_status`;

      const currentUsage = (await secureStorageService.retrieve(
        rateLimitKey
      )) || { limit: 100, remaining: 100, reset: 0, count: 0 };

      const parsedLimit = parseInt(limit, 10);
      const parsedRemaining = parseInt(remaining, 10);
      const parsedReset = parseInt(reset, 10);
      const parsedCount = parseInt(usageCount, 10);

      const effectiveLimit = !isNaN(parsedLimit)
        ? parsedLimit
        : currentUsage.limit;
      const effectiveCount = !isNaN(parsedCount)
        ? parsedCount
        : currentUsage.count;
      const derivedRemaining = !isNaN(parsedRemaining)
        ? parsedRemaining
        : Math.max(0, effectiveLimit - effectiveCount);

      const newUsage = {
        limit: effectiveLimit,
        remaining: derivedRemaining,
        reset: !isNaN(parsedReset) ? parsedReset : currentUsage.reset,
        count: effectiveCount,
      };

      await secureStorageService.save(rateLimitKey, newUsage);

      try {
        await chrome.runtime.sendMessage({
          action: "rateLimitUpdate",
          usage: newUsage,
        });
      } catch (_) {}
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const message =
        errorData?.message ||
        errorData?.error ||
        `Proxy service error: ${response.status}`;
      const error = new Error(message);
      error.status = response.status;
      error.data = { code: errorData?.code };
      throw error;
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
    sendResponse({
      success: false,
      error: typeof error === "object" && error && error.message ? error.message : String(error),
    });
  }
}
