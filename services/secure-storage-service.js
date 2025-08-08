import { cryptoService } from './crypto-service.js';

class SecureStorageService {
  constructor() {
    this.encryptionKeyId = 'extension_encryption_key';
    this.passphraseMode = false;
    this.passphraseKey = null;
    this.inactivityTimer = null;
    this.INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;
    this.PASSKEYED_KEYS = new Set(['byokApiKey']);
  }

  async initializeEncryptionKey() {
    const result = await chrome.storage.local.get(this.encryptionKeyId);
    if (result[this.encryptionKeyId]) {
      return cryptoService.importKey(result[this.encryptionKeyId]);
    } else {
      const newKey = await cryptoService.generateKey();
      const exportedKey = await cryptoService.exportKey(newKey);
      await chrome.storage.local.set({ [this.encryptionKeyId]: exportedKey });
      return newKey;
    }
  }

  async enablePassphraseMode(passphrase) {
    if (typeof passphrase !== 'string' || !passphrase.trim()) {
      throw new Error('Passphrase required');
    }
    const { key, salt } = await cryptoService.deriveKeyFromPassword(passphrase);
    this.passphraseKey = key;
    this.passphraseMode = true;
    await chrome.storage.local.set({ byok_passphrase_salt: salt, byok_passphrase_enabled: true });
    this._touchPassphraseActivity();
  }

  disablePassphraseMode() {
    this.passphraseKey = null;
    this.passphraseMode = false;
    if (this.inactivityTimer) {
      clearTimeout(this.inactivityTimer);
      this.inactivityTimer = null;
    }
    chrome.storage.local.remove(['byok_passphrase_salt', 'byok_passphrase_enabled']).catch(() => {});
  }

  isPassphraseModeEnabled() {
    return this.passphraseMode === true && this.passphraseKey !== null;
  }

  async save(key, value) {
    try {
      const usePassphrase = this.isPassphraseModeEnabled() && this.PASSKEYED_KEYS.has(key);
      const encryptionKey = usePassphrase
        ? this.passphraseKey
        : await this.initializeEncryptionKey();
      const encryptedValue = await cryptoService.encrypt(value, encryptionKey);
      await chrome.storage.local.set({ [key]: encryptedValue });
      if (usePassphrase) this._touchPassphraseActivity();
    } catch (error) {
      console.error(`Failed to save data for key: ${key}`, error);
      throw new Error(`Failed to save data: ${error.message}`);
    }
  }

  async retrieve(key) {
    try {
      const result = await chrome.storage.local.get(key);
      if (!result[key]) {
        return null;
      }
      const usePassphrase = this.isPassphraseModeEnabled() && this.PASSKEYED_KEYS.has(key);
      const encryptionKey = usePassphrase
        ? this.passphraseKey
        : await this.initializeEncryptionKey();
      if (usePassphrase && !encryptionKey) {
        return null;
      }
      const value = await cryptoService.decrypt(result[key], encryptionKey);
      if (usePassphrase) this._touchPassphraseActivity();
      return value;
    } catch (error) {
      console.error(`Failed to retrieve data for key: ${key}`, error);
      // This can happen if the key changes or data is corrupt.
      // For now, we return null, effectively resetting the value.
      return null;
    }
  }

  async remove(key) {
    try {
      await chrome.storage.local.remove(key);
    } catch (error) {
      console.error(`Failed to remove data for key: ${key}`, error);
      throw new Error(`Failed to remove data: ${error.message}`);
    }
  }

  /**
   * @deprecated since v2.0.0, use remove(key) instead.
   */
  async clearApiKey() {
    return this.remove('encrypted_api_key');
  }

  _touchPassphraseActivity() {
    if (!this.isPassphraseModeEnabled()) return;
    if (this.inactivityTimer) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => {
      this.passphraseKey = null;
      this.passphraseMode = false;
      this.inactivityTimer = null;
    }, this.INACTIVITY_TIMEOUT_MS);
  }
}

export const secureStorageService = new SecureStorageService();
 