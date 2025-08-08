import { cryptoService } from './crypto-service.js';

class SecureStorageService {
  constructor() {
    this.encryptionKeyId = 'extension_encryption_key';
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

  async save(key, value) {
    try {
      const encryptionKey = await this.initializeEncryptionKey();
      const encryptedValue = await cryptoService.encrypt(value, encryptionKey);
      await chrome.storage.local.set({ [key]: encryptedValue });
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
      const encryptionKey = await this.initializeEncryptionKey();
      return cryptoService.decrypt(result[key], encryptionKey);
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
}

export const secureStorageService = new SecureStorageService();
 