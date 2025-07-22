chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "enhancePrompt") {
    const { prompt, apiKey } = request;
    
    console.log("Enhancement request received:", { prompt: prompt?.substring(0, 100), hasApiKey: !!apiKey });
    
    if (!apiKey) {
      sendResponse({ success: false, error: "API key not found." });
      return;
    }

    if (!prompt || prompt.trim().length === 0) {
      sendResponse({ success: false, error: "No prompt provided." });
      return;
    }

    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": chrome.runtime.getURL(""),
        "X-Title": "Prompt Enhancer Chrome Extension"
      },
      body: JSON.stringify({
        model: "openai/gpt-3.5-turbo",
        messages: [
          { 
            role: "system", 
            content: "You are a prompt enhancer. Rewrite the user's prompt to be more detailed, specific, and effective. Keep the same intent but make it clearer and more comprehensive. Return only the enhanced prompt, no explanations." 
          },
          { role: "user", content: prompt.trim() }
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    })
    .then(async response => {
      console.log("API Response status:", response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error("API Error:", response.status, errorText);
        throw new Error(`API Error ${response.status}: ${errorText}`);
      }
      
      return response.json();
    })
    .then(data => {
      console.log("API Response data:", data);
      
      if (data.choices && data.choices.length > 0 && data.choices[0].message) {
        const enhancedPrompt = data.choices[0].message.content.trim();
        console.log("Enhancement successful");
        sendResponse({ success: true, enhancedPrompt });
      } else {
        console.error("Invalid response structure:", data);
        sendResponse({ success: false, error: "Invalid response from API." });
      }
    })
    .catch(error => {
      console.error("Enhancement error:", error);
      let errorMessage = "An unexpected error occurred.";
      
      if (error.message.includes("401")) {
        errorMessage = "Invalid API key. Please check your OpenRouter API key.";
      } else if (error.message.includes("429")) {
        errorMessage = "Rate limit exceeded. Please try again later.";
      } else if (error.message.includes("fetch")) {
        errorMessage = "Network error. Please check your internet connection.";
      } else if (error.message.includes("API Error")) {
        errorMessage = error.message;
      }
      
      sendResponse({ success: false, error: errorMessage });
    });

    return true; // Indicates an asynchronous response
  }
}); 