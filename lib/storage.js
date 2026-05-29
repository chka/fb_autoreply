export const DEFAULTS = Object.freeze({
  fcApiKey: '',
  fcCustomer: '',
  defaultModel: 'fc:openai/gpt-4o',
  defaultTone: 'Nice',
  defaultLength: 'Medium',
  enableInformationSearch: true,
  enableOnFacebook: true,
  enableOnX: true,
  safetyCeiling: true,
  lastUsed: { fb: null, x: null },
});

const KEYS = Object.keys(DEFAULTS);

export function getSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(KEYS, stored => {
      const out = { ...DEFAULTS };
      for (const k of KEYS) {
        if (stored[k] !== undefined) out[k] = stored[k];
      }
      resolve(out);
    });
  });
}

export function setSettings(patch) {
  return new Promise(resolve => {
    chrome.storage.local.set(patch, () => resolve());
  });
}
