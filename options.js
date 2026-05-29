import { getSettings, setSettings, DEFAULTS } from './lib/storage.js';

const FIELDS = [
  'fcApiKey', 'fcCustomer', 'defaultModel', 'defaultTone', 'defaultLength',
  'enableInformationSearch', 'enableOnFacebook', 'enableOnX',
];

async function load() {
  const s = await getSettings();
  for (const f of FIELDS) {
    const el = document.getElementById(f);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!s[f];
    else el.value = s[f] ?? '';
  }
}

async function save() {
  const patch = {};
  for (const f of FIELDS) {
    const el = document.getElementById(f);
    if (!el) continue;
    patch[f] = el.type === 'checkbox' ? el.checked : el.value;
  }
  await setSettings(patch);
  status('Saved.');
}

function status(msg, isErr = false) {
  const el = document.getElementById('status');
  el.style.color = isErr ? '#ef4444' : '#8fa3c5';
  el.textContent = msg;
}

async function testKey() {
  const key = document.getElementById('fcApiKey').value.trim();
  if (!key) return status('Enter a key first', true);
  status('Testing…');
  try {
    const resp = await fetch('https://api.fightclub.pro/v1/models', {
      headers: { 'Authorization': `Bearer ${key}` },
    });
    if (resp.ok) status('Key OK ✓');
    else if (resp.status === 401) status('Key rejected (401)', true);
    else status(`Unexpected status ${resp.status}`, true);
  } catch (e) {
    status(`Network error: ${e.message}`, true);
  }
}

document.getElementById('save').addEventListener('click', save);
document.getElementById('testKey').addEventListener('click', testKey);
load();
