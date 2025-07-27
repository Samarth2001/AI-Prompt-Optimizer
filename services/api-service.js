// API service for prompt enhancement

export function getStoredApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['apiKey'], (result) => {
      resolve(result.apiKey || null);
    });
  });
}

export async function enhancePrompt(prompt) {
  const apiKey = await getStoredApiKey();
  if (!apiKey) {
    alert('Please set your API key in the extension popup first!');
    return null;
  }

  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { action: 'enhancePrompt', apiKey, prompt },
      (response) => {
        if (response && response.success) {
          resolve(response.enhancedPrompt);
        } else {
          console.error('Enhancement failed:', response?.error);
          alert('Enhancement failed: ' + (response?.error || 'Unknown error'));
          resolve(null);
        }
      }
    );
  });
}
