'use strict';

const fs = require('fs');
const path = require('path');

// Settings live in a JSON file in the user's app-data folder. The API key is
// encrypted with the OS keychain (DPAPI on Windows) when available.
class SettingsStore {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, 'settings.json');
    this.safeStorage = safeStorage;
    this.data = { model: 'claude-opus-5-5', englishVariant: 'US', citationStyle: 'APA 7', apiKeyEnc: null, apiKeyPlain: null };
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
    } catch {
      // First run or unreadable file: keep defaults.
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  getApiKey() {
    if (this.data.apiKeyEnc && this.safeStorage && this.safeStorage.isEncryptionAvailable()) {
      try {
        return this.safeStorage.decryptString(Buffer.from(this.data.apiKeyEnc, 'base64'));
      } catch {
        return null;
      }
    }
    return this.data.apiKeyPlain || null;
  }

  setApiKey(key) {
    key = (key || '').trim();
    this.data.apiKeyEnc = null;
    this.data.apiKeyPlain = null;
    if (key) {
      if (this.safeStorage && this.safeStorage.isEncryptionAvailable()) {
        this.data.apiKeyEnc = this.safeStorage.encryptString(key).toString('base64');
      } else {
        this.data.apiKeyPlain = key;
      }
    }
  }

  // What the renderer may see: never the key itself.
  publicView() {
    const { apiKeyEnc, apiKeyPlain, ...rest } = this.data;
    return { ...rest, hasApiKey: !!this.getApiKey() || !!process.env.ANTHROPIC_API_KEY };
  }

  update(patch) {
    if ('apiKey' in patch) this.setApiKey(patch.apiKey);
    for (const k of ['model', 'englishVariant', 'citationStyle']) {
      if (typeof patch[k] === 'string') this.data[k] = patch[k];
    }
    this.save();
    return this.publicView();
  }
}

module.exports = { SettingsStore };
