import { describe, it, expect, vi, beforeEach } from 'vitest';
import { callRingside, RingsideError } from '../lib/ringside.js';

describe('callRingside', () => {
  beforeEach(() => { globalThis.fetch = vi.fn(); });

  const okBody = {
    choices: [{ message: { role: 'assistant', content: 'hello reply' } }],
  };

  it('POSTs to api.fightclub.pro with bearer auth and returns content', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => okBody });
    const out = await callRingside({
      apiKey: 'sk_test', model: 'gpt-4o',
      system: 'sys', user: 'usr', maxTokens: 400, temperature: 0.8,
    });
    expect(out).toBe('hello reply');
    const [url, opts] = fetch.mock.calls[0];
    expect(url).toBe('https://api.fightclub.pro/v1/chat/completions');
    expect(opts.method).toBe('POST');
    expect(opts.headers.Authorization).toBe('Bearer sk_test');
    expect(opts.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('gpt-4o');
    expect(body.temperature).toBe(0.8);
    expect(body.max_tokens).toBe(400);
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'usr' },
    ]);
  });

  it('sends FC-Customer header when customer set', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => okBody });
    await callRingside({
      apiKey: 'sk_test', model: 'gpt-4o', system: 's', user: 'u',
      maxTokens: 100, temperature: 0.5, customer: 'cust_42',
    });
    expect(fetch.mock.calls[0][1].headers['FC-Customer']).toBe('cust_42');
  });

  it('omits FC-Customer header when not set', async () => {
    fetch.mockResolvedValue({ ok: true, status: 200, json: async () => okBody });
    await callRingside({
      apiKey: 'sk_test', model: 'gpt-4o', system: 's', user: 'u',
      maxTokens: 100, temperature: 0.5,
    });
    expect(fetch.mock.calls[0][1].headers['FC-Customer']).toBeUndefined();
  });

  it('throws RingsideError with 401 status on bad key', async () => {
    fetch.mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'bad key' }) });
    await expect(callRingside({
      apiKey: 'x', model: 'gpt-4o', system: 's', user: 'u', maxTokens: 100, temperature: 0.5,
    })).rejects.toMatchObject({ status: 401, code: 'unauthorized' });
  });

  it('throws RingsideError with code rate_limited on 429', async () => {
    fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    await expect(callRingside({
      apiKey: 'x', model: 'gpt-4o', system: 's', user: 'u', maxTokens: 100, temperature: 0.5,
    })).rejects.toMatchObject({ status: 429, code: 'rate_limited' });
  });

  it('retries once on 5xx, succeeds second time', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => okBody });
    const out = await callRingside({
      apiKey: 'x', model: 'gpt-4o', system: 's', user: 'u', maxTokens: 100, temperature: 0.5,
    });
    expect(out).toBe('hello reply');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('throws on network error', async () => {
    fetch.mockRejectedValue(new Error('network down'));
    await expect(callRingside({
      apiKey: 'x', model: 'gpt-4o', system: 's', user: 'u', maxTokens: 100, temperature: 0.5,
    })).rejects.toMatchObject({ code: 'network' });
  });

  it('supports AbortController signal', async () => {
    const ctrl = new AbortController();
    fetch.mockImplementation((_url, opts) => new Promise((_res, rej) => {
      opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')));
    }));
    const p = callRingside({
      apiKey: 'x', model: 'gpt-4o', system: 's', user: 'u',
      maxTokens: 100, temperature: 0.5, signal: ctrl.signal,
    });
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
  });
});
