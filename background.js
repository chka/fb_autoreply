import { callRingside, RingsideError } from './lib/ringside.js';
import { searchDDG, buildQuery } from './lib/ddg.js';
import { checkDraft } from './lib/safety.js';
import { getSettings } from './lib/storage.js';
import { buildSystemPrompt, buildUserMessage, MAX_TOKENS, TONES, LENGTHS } from './lib/prompts.js';

const MAX_PAYLOAD_BYTES = 8 * 1024;

const inFlight = new Map();

function payloadBytes(p) {
  return new Blob([JSON.stringify(p)]).size;
}

export async function handleMessage(msg, sender = {}) {
  if (msg?.type === 'generate') return generate(msg.payload, sender);
  if (msg?.type === 'abort') {
    const c = inFlight.get(sender.tab?.id);
    if (c) { c.abort(); inFlight.delete(sender.tab?.id); }
    return { ok: true };
  }
  return { ok: false, error: `unknown message type: ${msg?.type}` };
}

async function generate(p, sender) {
  if (!p || !TONES.includes(p.tone) || !LENGTHS.includes(p.length)) {
    return { ok: false, error: 'invalid tone or length' };
  }
  if (payloadBytes(p) > MAX_PAYLOAD_BYTES) {
    return { ok: false, error: 'context too large (>8 KB)' };
  }

  const settings = await getSettings();
  if (!settings.fcApiKey) {
    return { ok: false, code: 'no_key', error: 'API key missing - open options' };
  }

  let research;
  if (p.tone === 'Information' && settings.enableInformationSearch) {
    const q = buildQuery({ text: p.target?.text || '', author: p.target?.author || '' });
    research = await searchDDG(q);
  } else if (p.tone === 'Information') {
    research = [];
  }

  const system = buildSystemPrompt({
    tone: p.tone, length: p.length, platform: p.platform, research,
  });
  const user = buildUserMessage(p);

  const ctrl = new AbortController();
  if (sender.tab?.id != null) {
    const prev = inFlight.get(sender.tab.id);
    if (prev) prev.abort();
    inFlight.set(sender.tab.id, ctrl);
  }

  let draft;
  try {
    draft = await callRingside({
      apiKey: settings.fcApiKey,
      customer: settings.fcCustomer || undefined,
      model: p.model || settings.defaultModel,
      system, user,
      maxTokens: MAX_TOKENS[p.length],
      temperature: p.temperature ?? 0.8,
      signal: ctrl.signal,
    });
  } catch (e) {
    return { ok: false, code: e.code || 'unknown', error: e.message };
  } finally {
    if (sender.tab?.id != null && inFlight.get(sender.tab.id) === ctrl) {
      inFlight.delete(sender.tab.id);
    }
  }

  if (settings.safetyCeiling) {
    const check = checkDraft(draft);
    if (!check.ok) return { ok: false, code: 'blocked', error: `blocked: ${check.reason}` };
  }

  return { ok: true, draft };
}

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg, sender).then(sendResponse).catch(e =>
      sendResponse({ ok: false, error: e.message || String(e) }));
    return true;
  });
}
