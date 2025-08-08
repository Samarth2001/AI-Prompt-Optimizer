import { secureStorageService } from "./services/secure-storage-service.js";
import { validationService } from "./services/validation-service.js";

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getApiKey") {
    (async () => {
      try {
        const apiKey = await secureStorageService.retrieveApiKey();
        sendResponse({ apiKey });
      } catch (error) {
        console.error("Error retrieving API key:", error);
        sendResponse({ apiKey: null });
      }
    })();
    return true;
  }

  if (request.action === "enhancePrompt") {
    const { prompt, apiKey } = request;

    console.log("Enhancement request received:", {
      prompt: prompt?.substring(0, 100),
      hasApiKey: !!apiKey,
    });

    if (!apiKey) {
      sendResponse({ success: false, error: "API key not found." });
      return;
    }

    if (!prompt || prompt.trim().length === 0) {
      sendResponse({ success: false, error: "No prompt provided." });
      return;
    }

    const sanitizedPrompt = validationService.sanitizeApiKey(prompt.trim());

    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": chrome.runtime.getURL(""),
        "X-Title": "Prompt Enhancer Chrome Extension",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-exp:free",
        messages: [
          {
            role: "system",
            content:
              'You are an expert prompt optimizer. Your task is to transform user prompts into highly specific, actionable, and effective versions while preserving their exact intent and desired outcome.\n\nCORE PRINCIPLES:\n1. PRESERVE INTENT: Never change what the user fundamentally wants to achieve\n2. ADD SPECIFICITY: Transform vague requests into precise, detailed instructions\n3. INFER CONTEXT: When prompts are unclear, make reasonable assumptions about the user\'s likely goals based on common use cases\n4. AVOID GENERICS: Replace broad terms with specific, actionable language\n5. MAINTAIN VOICE: Keep the user\'s preferred tone and style preferences\n\nENHANCEMENT STRATEGY:\n- If prompt is vague: Infer the most likely specific intent and make it explicit\n- Add missing context: purpose, audience, format, constraints, desired outcome\n- Replace weak words: "good" → "professional and engaging", "help" → "provide step-by-step guidance"\n- Specify deliverables: What exactly should the output look like?\n- Include success criteria: How will the user know it\'s what they wanted?\n\nEXAMPLES OF TRANSFORMATION:\n- "Write an email" → "Write a professional email with [specific purpose], including clear subject line, polite greeting, structured body with key points, and appropriate closing for [inferred context]"\n- "Explain this" → "Provide a clear, step-by-step explanation of [topic] suitable for [inferred audience level], including practical examples and key takeaways"\n\nReturn ONLY the enhanced prompt with no explanations or meta-commentary. Make every word count toward creating the exact output the user truly wants.',
          },
          { role: "user", content: sanitizedPrompt },
        ],
        max_tokens: 500,
        temperature: 0.7,
      }),
    })
      .then(async (response) => {
        console.log("API Response status:", response.status);

        if (!response.ok) {
          const errorText = await response.text();
          console.error("API Error:", response.status, errorText);
          throw new Error(`API Error ${response.status}: ${errorText}`);
        }

        return response.json();
      })
      .then((data) => {
        console.log("API Response data:", data);

        if (
          data.choices &&
          data.choices.length > 0 &&
          data.choices[0].message
        ) {
          const enhancedPrompt = data.choices[0].message.content.trim();
          console.log("Enhancement successful");
          sendResponse({ success: true, enhancedPrompt });
        } else {
          console.error("Invalid response structure:", data);
          sendResponse({ success: false, error: "Invalid response from API." });
        }
      })
      .catch((error) => {
        console.error("Enhancement error:", error);
        let errorMessage = "An unexpected error occurred.";

        if (error.message.includes("401")) {
          errorMessage =
            "Invalid API key. Please check your OpenRouter API key.";
        } else if (error.message.includes("429")) {
          errorMessage = "Rate limit exceeded. Please try again later.";
        } else if (error.message.includes("fetch")) {
          errorMessage =
            "Network error. Please check your internet connection.";
        } else if (error.message.includes("API Error")) {
          errorMessage = error.message;
        }

        sendResponse({ success: false, error: errorMessage });
      });

    return true; // Indicates an asynchronous response
  }
});
