import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getSettings, setSettings, DEFAULTS } from '../lib/storage.js';

function mockChromeStorage(initial = {}) {
  const store = { ...initial };
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn((keys, cb) => cb(Object.fromEntries(
          (Array.isArray(keys) ? keys : Object.keys(keys)).map(k => [k, store[k]])
        ))),
        set: vi.fn((obj, cb) => { Object.assign(store, obj); cb && cb(); }),
      },
    },
  };
  return store;
}

describe('storage', () => {
  beforeEach(() => mockChromeStorage());

  it('returns DEFAULTS when nothing is stored', async () => {
    const s = await getSettings();
    expect(s.defaultTone).toBe(DEFAULTS.defaultTone);
    expect(s.defaultLength).toBe(DEFAULTS.defaultLength);
    expect(s.fcApiKey).toBe('');
    expect(s.enableOnFacebook).toBe(true);
    expect(s.enableOnX).toBe(true);
    expect(s.safetyCeiling).toBe(true);
  });

  it('persists and reads back values', async () => {
    await setSettings({ fcApiKey: 'sk_test_123', defaultModel: 'claude-3-5-sonnet' });
    const s = await getSettings();
    expect(s.fcApiKey).toBe('sk_test_123');
    expect(s.defaultModel).toBe('claude-3-5-sonnet');
    expect(s.defaultTone).toBe(DEFAULTS.defaultTone);
  });
});
