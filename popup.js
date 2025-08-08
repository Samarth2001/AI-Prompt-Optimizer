import { secureStorageService } from './services/secure-storage-service.js';
import { validationService } from './services/validation-service.js';

document.addEventListener("DOMContentLoaded", async () => {
  const modeToggle = document.getElementById("mode-toggle");
  const apiKeyInput = document.getElementById("api-key-input");
  const saveKeyButton = document.getElementById("save-key-button");
  const clearKeyButton = document.getElementById("clear-key-button");
  const statusMessage = document.getElementById("status-message");
  const apiSection = document.getElementById("api-section");
  const usageText = document.getElementById("usage-text");
  const usageProgress = document.getElementById("usage-progress");
  const modeLabel = document.getElementById("mode-label");
  const passphraseToggle = document.getElementById("passphrase-toggle");
  const passphraseRow = document.getElementById("passphrase-row");
  const passphraseInput = document.getElementById("passphrase-input");
  const setPassphraseButton = document.getElementById("set-passphrase-button");

  async function initialize() {
    const { mode } = await chrome.storage.local.get({ mode: 'proxy' });
    const apiKey = await secureStorageService.retrieve("byokApiKey");

    modeToggle.checked = mode === 'byok';
    document.body.dataset.mode = mode;
    updateUIMode(mode, !!apiKey);
    updateModeLabel(mode);

    if (mode === 'proxy') {
      updateUsage();
    }
  }

  function updateUIMode(mode, hasApiKey) {
    document.body.dataset.mode = mode;
    apiSection.classList.toggle('hidden', mode !== 'byok');
    clearKeyButton.classList.toggle('hidden', !hasApiKey);
  }

  function updateModeLabel(mode) {
    modeLabel.textContent = mode === 'byok' ? 'BYOK' : 'Proxy';
  }

  async function updateUsage() {
    const usage = await chrome.runtime.sendMessage({ action: 'getUsage' });
    if (usage && typeof usage.count === 'number') {
        const DAILY_LIMIT = 100;
        const remaining = Math.max(0, DAILY_LIMIT - usage.count);
        usageText.textContent = `${remaining} / ${DAILY_LIMIT} remaining`;
        usageProgress.style.width = `${(remaining / DAILY_LIMIT) * 100}%`;
    }
  }

  modeToggle.addEventListener('change', async () => {
    modeToggle.disabled = true;
    const newMode = modeToggle.checked ? 'byok' : 'proxy';
    await chrome.storage.local.set({ mode: newMode });
    const apiKey = await secureStorageService.retrieve("byokApiKey");
    updateUIMode(newMode, !!apiKey);
    updateModeLabel(newMode);

    if (newMode === 'proxy') {
        await updateUsage();
    }
    modeToggle.disabled = false;
  });

  saveKeyButton.addEventListener("click", async () => {
    const apiKey = validationService.sanitizeInput(apiKeyInput.value);
    
    if (!apiKey) {
      showStatus("Please enter an API key", "error");
      return;
    }

    try {
      await secureStorageService.save("byokApiKey", apiKey);
      apiKeyInput.value = "";
      updateUIMode('byok', true);
      showStatus("API key saved and encrypted successfully!", "success");
    } catch (error) {
      showStatus(`Failed to save API key: ${error.message}`, "error");
    }
  });

  passphraseToggle.addEventListener('change', async () => {
    const enabled = passphraseToggle.checked;
    passphraseRow.classList.toggle('hidden', !enabled);
    if (!enabled) {
      secureStorageService.disablePassphraseMode();
      passphraseInput.value = '';
      showStatus('Passphrase mode disabled', 'info');
    }
  });

  setPassphraseButton.addEventListener('click', async () => {
    const pass = validationService.sanitizeInput(passphraseInput.value);
    if (!pass) {
      showStatus('Please enter a passphrase', 'error');
      return;
    }
    try {
      await secureStorageService.enablePassphraseMode(pass);
      passphraseInput.value = '';
      showStatus('Passphrase set. Your key will be locked with it.', 'success');
    } catch (e) {
      showStatus(`Failed to enable passphrase: ${e.message}`, 'error');
    }
  });

  clearKeyButton.addEventListener("click", async () => {
    try {
      await secureStorageService.remove("byokApiKey");
      apiKeyInput.value = "";
      updateUIMode('byok', false);
      showStatus("API key cleared successfully!", "success");
    } catch (error) {
      showStatus(`Failed to clear API key: ${error.message}`, "error");
    }
  });

  apiKeyInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      saveKeyButton.click();
    }
  });

  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status ${type} show`;
    setTimeout(() => {
      statusMessage.classList.remove("show");
    }, 3000);
  }

  initialize();
});
 