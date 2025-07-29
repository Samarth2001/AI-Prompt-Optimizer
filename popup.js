import { secureStorageService } from './services/secure-storage-service.js';
import { validationService } from './services/validation-service.js';

document.addEventListener("DOMContentLoaded", async () => {
  const apiKeyInput = document.getElementById("api-key-input");
  const saveKeyButton = document.getElementById("save-key-button");
  const clearKeyButton = document.getElementById("clear-key-button");
  const toggleInputButton = document.getElementById("toggle-input-button");
  const statusMessage = document.getElementById("status-message");
  const inputContainer = document.getElementById("input-container");
  const apiStatus = document.getElementById("api-status");
  const statusDot = document.getElementById("status-dot");
  const statusText = document.getElementById("status-text");

  // Load saved API key on startup
  try {
    const hasKey = await secureStorageService.hasStoredApiKey();
    if (hasKey) {
      setApiKeyState(true);
      showStatus("API key loaded securely", "info");
    } else {
      setApiKeyState(false);
    }
  } catch (error) {
    setApiKeyState(false);
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
      setApiKeyState(true);
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
      setApiKeyState(false);
      showStatus("API key cleared successfully!", "success");
    } catch (error) {
      showStatus(`Failed to clear API key: ${error.message}`, "error");
    }
  });

  // Toggle input visibility
  toggleInputButton.addEventListener("click", () => {
    showInputField();
  });

  // Handle Enter key in input
  apiKeyInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      saveKeyButton.click();
    }
  });

  function setApiKeyState(hasKey) {
    if (hasKey) {
      // API key is stored
      hideInputField();
      updateApiStatus("Configured", false);
      toggleInputButton.classList.remove("hidden");
      clearKeyButton.classList.remove("hidden");
      apiKeyInput.placeholder = "••••••••••••••••••••••••••••••••";
      apiKeyInput.classList.add("masked");
    } else {
      // No API key
      showInputField();
      updateApiStatus("No key", true);
      toggleInputButton.classList.add("hidden");
      clearKeyButton.classList.add("hidden");
      apiKeyInput.placeholder = "Enter your OpenRouter API key";
      apiKeyInput.classList.remove("masked");
    }
  }

  function updateApiStatus(text, isEmpty) {
    statusText.textContent = text;
    
    if (isEmpty) {
      statusDot.classList.add("empty");
      statusText.classList.add("empty");
    } else {
      statusDot.classList.remove("empty");
      statusText.classList.remove("empty");
    }
    
    // Show status with animation
    apiStatus.classList.add("show");
  }

  function hideInputField() {
    inputContainer.classList.remove("expanded");
    inputContainer.classList.add("collapsed");
  }

  function showInputField() {
    inputContainer.classList.remove("collapsed");
    inputContainer.classList.add("expanded");
    
    // Focus input after animation
    setTimeout(() => {
      apiKeyInput.focus();
    }, 200);
  }

  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status ${type}`;
    
    // Add show class for animation
    setTimeout(() => {
      statusMessage.classList.add("show");
    }, 50);
    
    if (type === "success" || type === "info") {
      setTimeout(() => {
        statusMessage.classList.remove("show");
        setTimeout(() => {
          statusMessage.textContent = "";
          statusMessage.className = "status";
        }, 300);
      }, 3000);
    }
  }
}); 