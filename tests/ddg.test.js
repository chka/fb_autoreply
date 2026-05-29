import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseResults, searchDDG, buildQuery } from '../lib/ddg.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = readFileSync(join(__dirname, 'fixtures/ddg-sample.html'), 'utf8');

describe('ddg parseResults', () => {
  it('extracts top 3 results from real HTML', () => {
    const results = parseResults(fixture);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results.length).toBeLessThanOrEqual(3);
    for (const r of results) {
      expect(r.title).toBeTypeOf('string');
      expect(r.url).toBeTypeOf('string');
      expect(r.snippet).toBeTypeOf('string');
      expect(r.title.length).toBeGreaterThan(0);
    }
  });

  it('returns [] on empty/garbage input', () => {
    expect(parseResults('')).toEqual([]);
    expect(parseResults('<html><body>nothing</body></html>')).toEqual([]);
  });
});

describe('buildQuery', () => {
  it('truncates long text to 200 chars and appends author', () => {
    const long = 'x'.repeat(500);
    const q = buildQuery({ text: long, author: 'Alice' });
    expect(q.length).toBeLessThanOrEqual(220);
    expect(q).toContain('Alice');
  });

  it('handles missing author', () => {
    const q = buildQuery({ text: 'short post' });
    expect(q).toContain('short post');
  });
});

describe('searchDDG', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  it('returns parsed results on 200', async () => {
    globalThis.fetch.mockResolvedValue({
      ok: true, status: 200, text: async () => fixture,
    });
    const r = await searchDDG('manifest v3');
    expect(r.length).toBeGreaterThan(0);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining('html.duckduckgo.com/html/?q=manifest%20v3'),
      expect.any(Object),
    );
  });

  it('returns [] on non-200', async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 503, text: async () => '' });
    expect(await searchDDG('x')).toEqual([]);
  });

  it('returns [] on fetch throw', async () => {
    globalThis.fetch.mockRejectedValue(new Error('network'));
    expect(await searchDDG('x')).toEqual([]);
  });
});
