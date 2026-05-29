import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleMessage } from '../background.js';
import * as ringside from '../lib/ringside.js';
import * as ddg from '../lib/ddg.js';
import * as safety from '../lib/safety.js';
import * as storage from '../lib/storage.js';

describe('handleMessage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(storage, 'getSettings').mockResolvedValue({
      fcApiKey: 'sk_test', fcCustomer: '', defaultModel: 'gpt-4o',
      defaultTone: 'Nice', defaultLength: 'Medium',
      enableInformationSearch: true, enableOnFacebook: true, enableOnX: true,
      safetyCeiling: true, lastUsed: { fb: null, x: null },
    });
  });

  it('rejects unknown type', async () => {
    const out = await handleMessage({ type: 'nope' });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/unknown/i);
  });

  it('rejects oversize context (>8 KB)', async () => {
    const huge = 'x'.repeat(9000);
    const out = await handleMessage({
      type: 'generate',
      payload: { platform: 'x', kind: 'post', tone: 'Nice', length: 'Short',
        target: { author: '@a', text: huge }, thread: [], url: 'https://x.com/a/status/1' },
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/too large/i);
  });

  it('rejects when API key missing', async () => {
    storage.getSettings.mockResolvedValue({ ...await storage.getSettings(), fcApiKey: '' });
    const out = await handleMessage({
      type: 'generate',
      payload: { platform: 'x', kind: 'post', tone: 'Nice', length: 'Short',
        target: { author: '@a', text: 'hi' }, thread: [], url: 'u' },
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/api key/i);
  });

  it('generates a Nice/Short/X draft end-to-end', async () => {
    vi.spyOn(ringside, 'callRingside').mockResolvedValue('hello there');
    const out = await handleMessage({
      type: 'generate',
      payload: { platform: 'x', kind: 'post', tone: 'Nice', length: 'Short',
        target: { author: '@a', text: 'hi' }, thread: [], url: 'u' },
    });
    expect(out.ok).toBe(true);
    expect(out.draft).toBe('hello there');
    const args = ringside.callRingside.mock.calls[0][0];
    expect(args.model).toBe('gpt-4o');
    expect(args.maxTokens).toBe(120);
    expect(args.system).toMatch(/Nice|warm/i);
  });

  it('calls DDG before Ringside for Information tone', async () => {
    const ddgSpy = vi.spyOn(ddg, 'searchDDG').mockResolvedValue([
      { title: 'T', url: 'https://t', snippet: 'snip' },
    ]);
    vi.spyOn(ringside, 'callRingside').mockResolvedValue('factual reply');
    const out = await handleMessage({
      type: 'generate',
      payload: { platform: 'x', kind: 'post', tone: 'Information', length: 'Medium',
        target: { author: '@a', text: 'is the sky blue?' }, thread: [], url: 'u' },
    });
    expect(ddgSpy).toHaveBeenCalled();
    const sysPrompt = ringside.callRingside.mock.calls[0][0].system;
    expect(sysPrompt).toMatch(/RESEARCH:/);
    expect(sysPrompt).toMatch(/https:\/\/t/);
    expect(out.draft).toBe('factual reply');
  });

  it('skips DDG when enableInformationSearch is false', async () => {
    storage.getSettings.mockResolvedValue({
      ...await storage.getSettings(), enableInformationSearch: false,
    });
    const ddgSpy = vi.spyOn(ddg, 'searchDDG').mockResolvedValue([]);
    vi.spyOn(ringside, 'callRingside').mockResolvedValue('ok');
    await handleMessage({
      type: 'generate',
      payload: { platform: 'x', kind: 'post', tone: 'Information', length: 'Short',
        target: { author: '@a', text: 'q' }, thread: [], url: 'u' },
    });
    expect(ddgSpy).not.toHaveBeenCalled();
  });

  it('blocks unsafe drafts via safety filter', async () => {
    vi.spyOn(ringside, 'callRingside').mockResolvedValue('I will kill you');
    const out = await handleMessage({
      type: 'generate',
      payload: { platform: 'x', kind: 'post', tone: 'Curse', length: 'Short',
        target: { author: '@a', text: 'hi' }, thread: [], url: 'u' },
    });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/blocked/i);
    expect(out.draft).toBeUndefined();
  });

  it('maps RingsideError code into out.error', async () => {
    vi.spyOn(ringside, 'callRingside').mockRejectedValue(
      new ringside.RingsideError('unauth', { status: 401, code: 'unauthorized' }),
    );
    const out = await handleMessage({
      type: 'generate',
      payload: { platform: 'x', kind: 'post', tone: 'Nice', length: 'Short',
        target: { author: '@a', text: 'hi' }, thread: [], url: 'u' },
    });
    expect(out.ok).toBe(false);
    expect(out.code).toBe('unauthorized');
  });
});
