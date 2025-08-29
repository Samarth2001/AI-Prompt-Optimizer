import { secureStorageService } from "./services/secure-storage-service.js";
import { validationService } from "./services/validation-service.js";

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
  const unlockInput = document.getElementById("unlock-input");
  const unlockButton = document.getElementById("unlock-button");
  const apiKeyGroup = document.getElementById("api-key-group");
  const keyStatusRow = document.getElementById("key-status-row");
  const keyStatusBadge = document.getElementById("key-status-badge");
  const editKeyButton = document.getElementById("edit-key-button");
  const cancelEditKeyButton = document.getElementById("cancel-edit-key-button");
  const apiNameInput = document.getElementById("api-name-input");
  const apiPassInput = document.getElementById("api-pass-input");
  const keySwitcherRow = document.getElementById("key-switcher-row");
  const keySelect = document.getElementById("key-select");
  const lockKeyButton = document.getElementById("lock-key-button");
  const resetExtensionButton = document.getElementById(
    "reset-extension-button"
  );
  let cachedKeys = [];

  async function initialize() {
    const { mode } = await chrome.storage.local.get({ mode: "proxy" });
    const configured = await secureStorageService.isPassphraseConfigured();
    await refreshKeyList();
    if (mode === "proxy") {
      try {
        const response = await chrome.runtime.sendMessage({ action: "ensureValidJwt" });
        if (response && !response.success) {
          throw new Error(response.error || "Security check failed. Please try again.");
        }
      } catch (error) {
        showStatus(error.message || "Could not connect to the service.", "error");
      }
    }

    modeToggle.checked = mode === "byok";
    document.body.dataset.mode = mode;
    const hasKey = await secureStorageService.exists("byokApiKey");
     updateUIMode(mode, hasKey);
    updateModeLabel(mode);

    if (mode === "proxy") {
      updateUsage();
    }
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

  async function updateUIMode(mode, hasApiKey) {
    document.body.dataset.mode = mode;
    apiSection.classList.toggle("hidden", mode !== "byok");

    const unlocked = secureStorageService.isPassphraseModeEnabled();
    apiSection.classList.toggle("unlocked", unlocked);
    clearKeyButton.classList.toggle("hidden", !unlocked);
    lockKeyButton.classList.toggle("hidden", !unlocked);
    keySwitcherRow.classList.toggle(
      "hidden",
      keySelect.options.length === 0 || unlocked
    );

    if (keyStatusRow && apiKeyGroup) {
      keyStatusRow.classList.toggle("hidden", false);
       apiKeyGroup.classList.toggle("hidden", true);
      await updateKeyStatusBadge();
    }
    // show key switcher if there are saved keys
    keySwitcherRow.classList.toggle("hidden", keySelect.options.length === 0);
    updateUnlockControls();
  }

  function updateModeLabel(mode) {
    modeLabel.textContent = mode === "byok" ? "BYOK" : "Proxy";
  }

  async function updateUsage() {
    const usage = await chrome.runtime.sendMessage({ action: "getUsage" });
    renderUsage(usage);
  }

  function renderUsage(usage) {
    const limit = (usage && usage.limit) || 100;
    const remaining = (usage && typeof usage.remaining === 'number') ? usage.remaining : limit;
    
    usageText.textContent = `${remaining} / ${limit} remaining`;
    usageProgress.style.width = `${(remaining / limit) * 100}%`;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === "rateLimitUpdate" && msg.usage) {
      renderUsage(msg.usage);
    }
  });

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (Object.prototype.hasOwnProperty.call(changes, "rate_limit_status")) {
      const usage = await chrome.runtime.sendMessage({ action: "getUsage" });
      renderUsage(usage);
    }
  });

  modeToggle.addEventListener("change", async () => {
    modeToggle.disabled = true;
    const newMode = modeToggle.checked ? "byok" : "proxy";
    await chrome.storage.local.set({ mode: newMode });
    const hasKey = await secureStorageService.exists("byokApiKey");
    await updateUIMode(newMode, hasKey);
    updateModeLabel(newMode);

    if (newMode === "proxy") {
      await updateUsage();
    }
    modeToggle.disabled = false;
  });

  saveKeyButton.addEventListener("click", async () => {
    const apiKey = validationService.sanitizeInput(apiKeyInput.value);
    const apiName = validationService.sanitizeInput(apiNameInput.value);
    const apiPass = validationService.sanitizeInput(apiPassInput.value);

    if (!apiName) {
      showStatus("Please enter a name", "error");
      return;
    }
    if (!apiKey) {
      showStatus("Please enter an API key", "error");
      return;
    }
    if (!apiKey.startsWith("sk-or-v1-")) {
      showStatus("Invalid API key format", "error");
      return;
    }
    if (!apiPass) {
      showStatus("Please set a passphrase", "error");
      return;
    }

    try {
      const id = await secureStorageService.addByokKey(
        apiName,
        apiKey,
        apiPass
      );
      await refreshKeyList(id);
      apiKeyInput.value = "";
      apiNameInput.value = "";
      apiPassInput.value = "";
      await updateUIMode("byok", false);
      pulse(apiKeyGroup);
      showStatus("Key saved. Enter passphrase to activate.", "success");
    } catch (error) {
      showStatus(`Failed to save API key: ${error.message}`, "error");
    }
  });

  
  unlockButton.addEventListener("click", async () => {
    const pass = validationService.sanitizeInput(unlockInput.value);
    if (!pass) {
      showStatus("Please enter your passphrase", "error");
      return;
    }
    try {
      const selectedId = keySelect.value;
      if (!selectedId) {
        showStatus("Select a key to unlock", "error");
        return;
      }
      unlockButton.disabled = true;
      await secureStorageService.unlockByokKey(selectedId, pass);
      const hasKey = await secureStorageService.exists("byokApiKey");
      await updateUIMode("byok", hasKey);
      pulse(keyStatusRow);
      try {
        await chrome.runtime.sendMessage({
          action: "unlockPassphrase",
          passphrase: pass,
        });
      } catch (_) {}
      unlockInput.value = "";
      showStatus(
        "Key unlocked. It will remain active until you lock it or close the browser.",
        "success"
      );
    } catch (e) {
      showStatus(e.message || "Invalid passphrase. Please try again.", "error");
    }
    unlockButton.disabled = false;
  });

  clearKeyButton.addEventListener("click", async () => {
    try {
      const configured = await secureStorageService.isPassphraseConfigured();
      if (configured && !secureStorageService.isPassphraseModeEnabled()) {
        showStatus("Unlock to detach key or use + New to add another", "error");
        return;
      }
      try {
        await chrome.runtime.sendMessage({ action: "lockPassphrase" });
      } catch (_) {}
      await secureStorageService.detachActiveByok();
      apiKeyInput.value = "";
      await updateUIMode("byok", false);
      showStatus("Key detached. Select and unlock to activate.", "success");
    } catch (error) {
      showStatus(`Failed to clear API key: ${error.message}`, "error");
    }
  });

  editKeyButton.addEventListener("click", async () => {
    apiKeyGroup.classList.remove("hidden");
    keyStatusRow.classList.remove("hidden");
    cancelEditKeyButton.classList.remove("hidden");
    apiKeyInput.value = "";
    apiNameInput.value = "";
    apiPassInput.value = "";
    apiKeyInput.focus();
  });

  cancelEditKeyButton.addEventListener("click", async () => {
    const hasKey = await secureStorageService.exists("byokApiKey");
    await updateUIMode("byok", hasKey);
  });

  async function refreshKeyList(selectId) {
    cachedKeys = await secureStorageService.listByokKeys();
    keySelect.innerHTML = "";
    for (const k of cachedKeys) {
      const opt = document.createElement("option");
      opt.value = k.id;
      opt.textContent = k.name;
      keySelect.appendChild(opt);
    }
    if (selectId) {
      keySelect.value = selectId;
    } else {
      const activeId = await secureStorageService.getActiveByokKeyId();
      if (activeId) keySelect.value = activeId;
    }
    keySwitcherRow.classList.toggle("hidden", cachedKeys.length === 0);
    updateUnlockControls();
    await updateKeyStatusBadge();
  }

  keySelect.addEventListener("change", async () => {
    unlockInput.value = "";
    try {
      await chrome.runtime.sendMessage({ action: "lockPassphrase" });
    } catch (_) {}
    await secureStorageService.detachActiveByok();
    await updateUIMode("byok", false);
    showStatus("Key switched. Enter passphrase to unlock.", "info");
  });

  apiKeyInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      saveKeyButton.click();
    }
  });

  lockKeyButton.addEventListener("click", async () => {
    try {
      await chrome.runtime.sendMessage({ action: "lockPassphrase" });
      await secureStorageService.detachActiveByok();
      const hasKey = await secureStorageService.exists("byokApiKey");
      await updateUIMode("byok", hasKey);
      showStatus("Key has been locked.", "info");
    } catch (error) {
      showStatus(`Error locking key: ${error.message}`, "error");
    }
  });

  resetExtensionButton.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "Are you sure you want to reset the extension? All saved keys and settings will be permanently deleted."
    );
    if (confirmed) {
      try {
        await chrome.storage.local.clear();
        try { await chrome.storage.session.clear(); } catch (_) {}
        showStatus("Extension has been reset. Reloading...", "success");
        // After clearing, we must re-fetch the remote config
        await chrome.runtime.sendMessage({ action: "updateRemoteConfig" });
        setTimeout(() => window.location.reload(), 1500);
      } catch (error) {
        showStatus(`Error resetting extension: ${error.message}`, "error");
      }
    }
  });

  function showStatus(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status ${type} show`;
    setTimeout(() => {
      statusMessage.classList.remove("show");
    }, 3000);
  }

  function pulse(el) {
    if (!el) return;
    el.classList.remove("pulse");
    void el.offsetWidth;
    el.classList.add("pulse");
    setTimeout(() => el.classList.remove("pulse"), 650);
  }

  async function updateKeyStatusBadge() {
    const activeId = await secureStorageService.getActiveByokKeyId();
    const unlocked = secureStorageService.isPassphraseModeEnabled();
    if (!cachedKeys || cachedKeys.length === 0) {
      keyStatusBadge.textContent = "Not set";
      keyStatusBadge.className = "status-badge-warn";
      return;
    }
    const selectedId = keySelect.value || activeId;
    const name =
      cachedKeys.find((k) => k.id === (activeId || selectedId))?.name ||
      "Unnamed";
    if (activeId && unlocked) {
      keyStatusBadge.textContent = `Active: ${name}`;
      keyStatusBadge.className = "status-badge-ok";
    } else {
      keyStatusBadge.textContent = selectedId
        ? `Locked: ${
            cachedKeys.find((k) => k.id === selectedId)?.name || "Unnamed"
          }`
        : "Locked";
      keyStatusBadge.className = "status-badge-warn";
    }
  }

  function updateUnlockControls() {
    const unlocked = secureStorageService.isPassphraseModeEnabled();
    const selectedId = keySelect.value;
    const needsUnlock = !unlocked;
    unlockInput.classList.toggle("hidden", !needsUnlock);
    unlockButton.classList.toggle("hidden", !needsUnlock);
    unlockButton.disabled = !needsUnlock;
  }

  initialize();
});

function loadTurnstileScript() {
  const script = document.createElement("script");
  script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

