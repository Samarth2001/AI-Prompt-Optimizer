document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("api-key-input");
  const saveKeyButton = document.getElementById("save-key-button");
  const statusMessage = document.getElementById("status-message");

  // Load saved API key on startup
  chrome.storage.local.get(['apiKey'], (result) => {
    if (result.apiKey) {
      apiKeyInput.value = result.apiKey;
      showStatus("API key loaded", "info");
    }
  });

  // Save API key
  saveKeyButton.addEventListener("click", () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus("Please enter an API key", "error");
      return;
    }

    if (!apiKey.startsWith('sk-or-v1-')) {
      showStatus("Invalid API key format. Should start with 'sk-or-v1-'", "error");
      return;
    }

    chrome.storage.local.set({ apiKey }, () => {
      showStatus("API key saved successfully!", "success");
    });
  });

  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status ${type}`;
    
    if (type === "success") {
      setTimeout(() => {
        statusMessage.textContent = "";
        statusMessage.className = "";
      }, 3000);
    }
  }
}); 