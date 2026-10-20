'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SettingsStore } = require('../src/main/settings');

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().replace(/^enc:/, ''),
};

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'quillwise-'));
}

test('stores a key per provider, encrypted, and never exposes it', () => {
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  const dir = tmpDir();
  const s = new SettingsStore(dir, fakeSafeStorage);
  let view = s.update({ provider: 'nvidia', nvidiaKey: 'nvapi-123', nvidiaModel: 'moonshotai/kimi-k2.6' });
  assert.deepStrictEqual(view.hasKey, { anthropic: false, nvidia: true });
  assert.strictEqual(view.hasApiKey, true);
  assert.ok(!JSON.stringify(view).includes('nvapi-123'));
  const file = fs.readFileSync(path.join(dir, 'settings.json'), 'utf8');
  assert.ok(!file.includes('nvapi-123'), 'key must be encrypted on disk');

  const again = new SettingsStore(dir, fakeSafeStorage);
  assert.strictEqual(again.getApiKey('nvidia'), 'nvapi-123');
  assert.strictEqual(again.data.nvidiaModel, 'moonshotai/kimi-k2.6');
  view = again.update({ provider: 'anthropic' });
  assert.strictEqual(view.hasApiKey, false);
  view = again.update({ provider: 'bogus', nvidiaKey: '  ' });
  assert.strictEqual(view.provider, 'anthropic');
  assert.strictEqual(again.getApiKey('nvidia'), 'nvapi-123', 'blank key field keeps the saved key');
});

test('migrates the 0.1.0 single-key format', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ model: 'claude-haiku-5-5', apiKeyEnc: Buffer.from('enc:sk-ant-old').toString('base64') }));
  const s = new SettingsStore(dir, fakeSafeStorage);
  assert.strictEqual(s.getApiKey('anthropic'), 'sk-ant-old');
  assert.strictEqual(s.data.provider, 'anthropic');
  assert.strictEqual(s.data.model, 'claude-haiku-5-5');
  assert.ok(!('apiKeyEnc' in s.data));
});
