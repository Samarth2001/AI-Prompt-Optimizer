import { cryptoService } from './crypto-service.js';

class SecureStorageService {
  constructor() {
    this.encryptionKeyId = 'extension_encryption_key';
    this.encryptedApiKeyId = 'encrypted_api_key';
    this.metadataId = 'encryption_metadata';
  }

  async initializeEncryption() {
    try {
      const result = await chrome.storage.local.get([this.encryptionKeyId]);
      
      if (!result[this.encryptionKeyId]) {
        const newKey = await cryptoService.generateKey();
        const exportedKey = await cryptoService.exportKey(newKey);
        
        await chrome.storage.local.set({
          [this.encryptionKeyId]: exportedKey
        });
        
        return newKey;
      } else {
        return await cryptoService.importKey(result[this.encryptionKeyId]);
      }
    } catch (error) {
      throw new Error(`Failed to initialize encryption: ${error.message}`);
    }
  }

  async storeApiKey(apiKey) {
    try {
      const encryptionKey = await this.initializeEncryption();
      const encryptedData = await cryptoService.encrypt(apiKey, encryptionKey);
      
      const metadata = {
        timestamp: Date.now(),
        version: '1.0'
      };

      await chrome.storage.local.set({
        [this.encryptedApiKeyId]: encryptedData,
        [this.metadataId]: metadata
      });

      return true;
    } catch (error) {
      throw new Error(`Failed to store API key: ${error.message}`);
    }
  }

  async retrieveApiKey() {
    try {
      const result = await chrome.storage.local.get([
        this.encryptedApiKeyId,
        this.metadataId
      ]);

      if (!result[this.encryptedApiKeyId]) {
        return null;
      }

      const encryptionKey = await this.initializeEncryption();
      const decryptedApiKey = await cryptoService.decrypt(
        result[this.encryptedApiKeyId],
        encryptionKey
      );

      return decryptedApiKey;
    } catch (error) {
      throw new Error(`Failed to retrieve API key: ${error.message}`);
    }
  }

  async hasStoredApiKey() {
    try {
      const result = await chrome.storage.local.get([this.encryptedApiKeyId]);
      return !!result[this.encryptedApiKeyId];
    } catch (error) {
      return false;
    }
  }

  async clearApiKey() {
    try {
      await chrome.storage.local.remove([
        this.encryptedApiKeyId,
        this.metadataId
      ]);
      return true;
    } catch (error) {
      throw new Error(`Failed to clear API key: ${error.message}`);
    }
  }

  async clearAllData() {
    try {
      await chrome.storage.local.remove([
        this.encryptionKeyId,
        this.encryptedApiKeyId,
        this.metadataId
      ]);
      return true;
    } catch (error) {
      throw new Error(`Failed to clear all data: ${error.message}`);
    }
  }

  async getStorageInfo() {
    try {
      const result = await chrome.storage.local.get([
        this.encryptedApiKeyId,
        this.metadataId
      ]);

      if (!result[this.metadataId]) {
        return null;
      }

      return {
        hasApiKey: !!result[this.encryptedApiKeyId],
        timestamp: result[this.metadataId].timestamp,
        version: result[this.metadataId].version
      };
    } catch (error) {
      return null;
    }
  }
}

export const secureStorageService = new SecureStorageService(); 