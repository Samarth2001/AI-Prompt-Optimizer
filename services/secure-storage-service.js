import { cryptoService } from "./crypto-service.js";

class SecureStorageService {
  constructor() {
    this.encryptionKeyId = "extension_encryption_key";
    this.passphraseMode = false;
    this.passphraseKey = null;
    this.PASSKEYED_KEYS = new Set(["byokApiKey"]);
    this.BYOK_KEYS_INDEX = "byok_keys_index";
    this.BYOK_ACTIVE_KEY_ID = "byok_active_key_id";
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
    if (typeof passphrase !== "string" || !passphrase.trim()) {
      throw new Error("Passphrase required");
    }
    const { key: derivedKey, salt } = await cryptoService.deriveKeyFromPassword(
      passphrase
    );

    const defaultKey = await this.initializeEncryptionKey();
    for (const keyName of this.PASSKEYED_KEYS) {
      const raw = await chrome.storage.local.get(keyName);
      if (!raw || !raw[keyName]) continue;
      try {
        const plaintext = await cryptoService.decrypt(raw[keyName], defaultKey);
        const reencrypted = await cryptoService.encrypt(plaintext, derivedKey);
        await chrome.storage.local.set({ [keyName]: reencrypted });
      } catch (_) {
        // If decrypt fails, skip re-encryption for this key
      }
    }

    this.passphraseKey = derivedKey;
    this.passphraseMode = true;
    await chrome.storage.local.set({
      byok_passphrase_salt: salt,
      byok_passphrase_enabled: true,
    });
  }

  disablePassphraseMode() {
    this.passphraseKey = null;
    this.passphraseMode = false;
    chrome.storage.local
      .remove(["byok_passphrase_salt", "byok_passphrase_enabled"])
      .catch(() => {});
  }

  async exists(key) {
    const res = await chrome.storage.local.get(key);
    return !!res && !!res[key];
  }

  async getKeysIndex() {
    const { [this.BYOK_KEYS_INDEX]: idx } = await chrome.storage.local.get({
      [this.BYOK_KEYS_INDEX]: {},
    });
    return idx || {};
  }

  async setKeysIndex(index) {
    await chrome.storage.local.set({ [this.BYOK_KEYS_INDEX]: index });
  }

  async listByokKeys() {
    const index = await this.getKeysIndex();
    return Object.entries(index).map(([id, meta]) => ({
      id,
      name: meta?.name || "Unnamed",
    }));
  }

  async addByokKey(name, apiKey, passphrase) {
    if (typeof name !== "string" || !name.trim())
      throw new Error("Name required");
    if (typeof apiKey !== "string" || !apiKey.trim())
      throw new Error("API key required");
    if (typeof passphrase !== "string" || !passphrase.trim())
      throw new Error("Passphrase required");

    const { key: derivedKey, salt } = await cryptoService.deriveKeyFromPassword(
      passphrase
    );
    const encryptedKeyBlob = await cryptoService.encrypt(apiKey, derivedKey);
    const id = crypto.randomUUID();

    const index = await this.getKeysIndex();
    index[id] = { name: name.trim(), salt };
    await this.setKeysIndex(index);
    await chrome.storage.local.set({
      [this._keyStorageName(id)]: encryptedKeyBlob,
      byok_passphrase_enabled: true,
    });
    this.disablePassphraseMode();
    return id;
  }

  async unlockByokKey(id, passphrase) {
    if (!id) throw new Error("Key not selected");
    if (typeof passphrase !== "string" || !passphrase.trim())
      throw new Error("Passphrase required");
    const index = await this.getKeysIndex();
    const meta = index[id];
    if (!meta || !Array.isArray(meta.salt)) throw new Error("Unknown key");
    const encrypted = (
      await chrome.storage.local.get(this._keyStorageName(id))
    )[this._keyStorageName(id)];
    if (!encrypted) throw new Error("Key data missing");

    const derivedKey = await cryptoService.recreateKeyFromPassword(
      passphrase,
      meta.salt
    );
    let plaintext;
    try {
      plaintext = await cryptoService.decrypt(encrypted, derivedKey);
    } catch (_) {
      throw new Error("Invalid passphrase");
    }
    this.passphraseKey = derivedKey;
    this.passphraseMode = true;
    await chrome.storage.local.set({
      [this.BYOK_ACTIVE_KEY_ID]: id,
      byok_passphrase_enabled: true,
      byok_passphrase_salt: meta.salt,
    });
     await this.save("byokApiKey", plaintext);
  }

  async getActiveByokKeyId() {
    const { [this.BYOK_ACTIVE_KEY_ID]: id } = await chrome.storage.local.get(
      this.BYOK_ACTIVE_KEY_ID
    );
    return id || null;
  }

  _keyStorageName(id) {
    return `byok_key_${id}`;
  }

  async isPassphraseConfigured() {
    const { byok_passphrase_enabled } = await chrome.storage.local.get({
      byok_passphrase_enabled: false,
    });
    return !!byok_passphrase_enabled;
  }

  async unlockWithPassphrase(passphrase) {
    if (typeof passphrase !== "string" || !passphrase.trim()) {
      throw new Error("Passphrase required");
    }
    const { byok_passphrase_salt } = await chrome.storage.local.get({
      byok_passphrase_salt: null,
    });
    if (!byok_passphrase_salt) {
      throw new Error("No passphrase configured");
    }
    const derivedKey = await cryptoService.recreateKeyFromPassword(
      passphrase,
      byok_passphrase_salt
    );

    const stored = await chrome.storage.local.get("byokApiKey");
    if (stored && stored.byokApiKey) {
      try {
        await cryptoService.decrypt(stored.byokApiKey, derivedKey);
      } catch (_) {
        throw new Error("Invalid passphrase");
      }
    }

    this.passphraseKey = derivedKey;
    this.passphraseMode = true;
  }

  async disablePassphraseModeAndReencrypt() {
    const configured = await this.isPassphraseConfigured();
    if (!configured) {
      this.disablePassphraseMode();
      return;
    }

    if (!this.isPassphraseModeEnabled()) {
      throw new Error("Unlock required to disable");
    }

    try {
      for (const keyName of this.PASSKEYED_KEYS) {
        const raw = await chrome.storage.local.get(keyName);
        if (!raw || !raw[keyName]) continue;

        const plaintext = await cryptoService.decrypt(
          raw[keyName],
          this.passphraseKey
        );
        const defaultKey = await this.initializeEncryptionKey();
        const reencrypted = await cryptoService.encrypt(plaintext, defaultKey);
        await chrome.storage.local.set({ [keyName]: reencrypted });
      }
    } finally {
      this.disablePassphraseMode();
    }
  }

  isPassphraseModeEnabled() {
    return this.passphraseMode === true && this.passphraseKey !== null;
  }
 
  async detachActiveByok() {
    try {
      await this.remove("byokApiKey");
    } catch (_) {}
    try {
      await chrome.storage.local.remove(this.BYOK_ACTIVE_KEY_ID);
    } catch (_) {}
    this.disablePassphraseMode();
  }

  async save(key, value) {
    try {
      const usePassphrase =
        this.isPassphraseModeEnabled() && this.PASSKEYED_KEYS.has(key);
      const encryptionKey = usePassphrase
        ? this.passphraseKey
        : await this.initializeEncryptionKey();
      const plaintext = typeof value === "string" ? value : JSON.stringify(value);
      const encryptedValue = await cryptoService.encrypt(plaintext, encryptionKey);
      await chrome.storage.local.set({ [key]: encryptedValue });
    } catch (error) {
      throw new Error(`Failed to save data: ${error.message}`);
    }
  }

  async retrieve(key) {
    try {
      const result = await chrome.storage.local.get(key);
      if (!result[key]) {
        return null;
      }
      const usePassphrase =
        this.isPassphraseModeEnabled() && this.PASSKEYED_KEYS.has(key);
      const encryptionKey = usePassphrase
        ? this.passphraseKey
        : await this.initializeEncryptionKey();
      if (usePassphrase && !encryptionKey) {
        return null;
      }
      const value = await cryptoService.decrypt(result[key], encryptionKey);
      try {
        return JSON.parse(value);
      } catch (_) {
        return value;
      }
    } catch (error) {
         return null;
    }
  }

  async remove(key) {
    try {
      await chrome.storage.local.remove(key);
    } catch (error) {
      throw new Error(`Failed to remove data: ${error.message}`);
    }
  }
 
  async clearApiKey() {
    return this.remove("encrypted_api_key");
  }
}

export const secureStorageService = new SecureStorageService();
