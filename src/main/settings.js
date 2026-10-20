'use strict';

const fs = require('fs');
const path = require('path');

const PROVIDERS = ['anthropic', 'nvidia'];
const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', nvidia: 'NVIDIA_API_KEY' };

// Settings live in a JSON file in the user's app-data folder. API keys are
// encrypted with the OS keychain (DPAPI on Windows) when available.
class SettingsStore {
  constructor(dir, safeStorage) {
    this.file = path.join(dir, 'settings.json');
    this.safeStorage = safeStorage;
    this.data = {
      provider: 'anthropic',
      model: 'claude-opus-5-5',
      nvidiaModel: 'mistralai/mistral-large-2-instruct',
      englishVariant: 'US',
      citationStyle: 'APA 7',
      keys: {}, // provider -> { enc } or { plain }
    };
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // Migrate the single-key format from 0.1.0.
      if (saved.apiKeyEnc || saved.apiKeyPlain) {
        saved.keys = { ...(saved.keys || {}), anthropic: saved.apiKeyEnc ? { enc: saved.apiKeyEnc } : { plain: saved.apiKeyPlain } };
      }
      delete saved.apiKeyEnc;
      delete saved.apiKeyPlain;
      Object.assign(this.data, saved);
    } catch {
      // First run or unreadable file: keep defaults.
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  canEncrypt() {
    return !!(this.safeStorage && this.safeStorage.isEncryptionAvailable());
  }

  getApiKey(provider = this.data.provider) {
    const stored = this.data.keys[provider];
    if (stored && stored.enc && this.canEncrypt()) {
      try {
        return this.safeStorage.decryptString(Buffer.from(stored.enc, 'base64'));
      } catch {
        return null;
      }
    }
    if (stored && stored.plain) return stored.plain;
    return process.env[KEY_ENV[provider]] || null;
  }

  setApiKey(provider, key) {
    key = (key || '').trim();
    if (!key) {
      delete this.data.keys[provider];
    } else if (this.canEncrypt()) {
      this.data.keys[provider] = { enc: this.safeStorage.encryptString(key).toString('base64') };
    } else {
      this.data.keys[provider] = { plain: key };
    }
  }

  // What the renderer may see: never the keys themselves.
  publicView() {
    const { keys, ...rest } = this.data;
    const hasKey = Object.fromEntries(PROVIDERS.map((p) => [p, !!this.getApiKey(p)]));
    return { ...rest, hasKey, hasApiKey: hasKey[this.data.provider] };
  }

  update(patch) {
    if (typeof patch.apiKey === 'string' && patch.apiKey.trim()) this.setApiKey('anthropic', patch.apiKey);
    if (typeof patch.nvidiaKey === 'string' && patch.nvidiaKey.trim()) this.setApiKey('nvidia', patch.nvidiaKey);
    if (PROVIDERS.includes(patch.provider)) this.data.provider = patch.provider;
    for (const k of ['model', 'nvidiaModel', 'englishVariant', 'citationStyle']) {
      if (typeof patch[k] === 'string' && patch[k].trim()) this.data[k] = patch[k].trim();
    }
    this.save();
    return this.publicView();
  }
}

module.exports = { SettingsStore, PROVIDERS };
