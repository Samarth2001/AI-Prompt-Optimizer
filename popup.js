import { secureStorageService } from './services/secure-storage-service.js';
import { validationService } from './services/validation-service.js';

document.addEventListener("DOMContentLoaded", async () => {
  const apiKeyInput = document.getElementById("api-key-input");
  const saveKeyButton = document.getElementById("save-key-button");
  const clearKeyButton = document.getElementById("clear-key-button");
  const statusMessage = document.getElementById("status-message");

  // Load saved API key on startup
  try {
    const hasKey = await secureStorageService.hasStoredApiKey();
    if (hasKey) {
      apiKeyInput.placeholder = "API key is stored securely";
      clearKeyButton.style.display = "inline-block";
      showStatus("API key loaded", "info");
    } else {
      clearKeyButton.style.display = "none";
    }
  } catch (error) {
    clearKeyButton.style.display = "none";
    showStatus("Error loading API key", "error");
  }

  // Save API key
  saveKeyButton.addEventListener("click", async () => {
    const apiKey = validationService.sanitizeApiKey(apiKeyInput.value);
    
    if (!apiKey) {
      showStatus("Please enter an API key", "error");
      return;
    }

    const validation = validationService.validateApiKeyFormat(apiKey);
    if (!validation.valid) {
      showStatus(validation.error, "error");
      return;
    }

    try {
      await secureStorageService.storeApiKey(apiKey);
      apiKeyInput.value = "";
      apiKeyInput.placeholder = "API key stored securely";
      clearKeyButton.style.display = "inline-block";
      showStatus("API key saved and encrypted successfully!", "success");
    } catch (error) {
      showStatus(`Failed to save API key: ${error.message}`, "error");
    }
  });

  // Clear API key
  clearKeyButton.addEventListener("click", async () => {
    try {
      await secureStorageService.clearApiKey();
      apiKeyInput.value = "";
      apiKeyInput.placeholder = "sk-or-v1-...";
      clearKeyButton.style.display = "none";
      showStatus("API key cleared successfully!", "success");
    } catch (error) {
      showStatus(`Failed to clear API key: ${error.message}`, "error");
    }
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