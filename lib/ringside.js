export class RingsideError extends Error {
  constructor(message, { status = 0, code = 'unknown' } = {}) {
    super(message);
    this.name = 'RingsideError';
    this.status = status;
    this.code = code;
  }
}

const ENDPOINT = 'https://api.fightclub.pro/v1/chat/completions';

function codeForStatus(status) {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

async function doFetch({ apiKey, customer, model, system, user, maxTokens, temperature, signal }) {
  const headers = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (customer) headers['FC-Customer'] = customer;
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    max_tokens: maxTokens,
  });
  return fetch(ENDPOINT, { method: 'POST', headers, body, signal });
}

export async function callRingside(opts) {
  let resp;
  try {
    resp = await doFetch(opts);
  } catch (e) {
    if (e.name === 'AbortError') throw new RingsideError('aborted', { code: 'aborted' });
    throw new RingsideError(e.message || 'network error', { code: 'network' });
  }
  if (!resp.ok && resp.status >= 500) {
    try {
      resp = await doFetch(opts);
    } catch (e) {
      if (e.name === 'AbortError') throw new RingsideError('aborted', { code: 'aborted' });
      throw new RingsideError(e.message || 'network error', { code: 'network' });
    }
  }
  if (!resp.ok) {
    throw new RingsideError(`ringside ${resp.status}`, {
      status: resp.status, code: codeForStatus(resp.status),
    });
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new RingsideError('malformed response', { status: resp.status, code: 'malformed' });
  }
  return content;
}
