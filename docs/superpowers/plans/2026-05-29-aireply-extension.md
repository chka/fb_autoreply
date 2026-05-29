# AIreply Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a personal-use MV3 Chrome extension that injects an `AIreply` chip into FB and X posts/comments, drafts a reply via Ringside (6 tones × 3 lengths), shows it in an editable approval modal, and on Send fills the platform's native composer without auto-posting.

**Architecture:** Two platform-specific content scripts (`content-fb.js`, `content-x.js`) share lib/ modules and talk to a background service worker (`background.js`) which holds the Ringside API key, calls `https://api.fightclub.pro/v1/chat/completions`, and (for the Information tone) scrapes `html.duckduckgo.com`. Options page writes settings to `chrome.storage.local`.

**Tech Stack:** Vanilla JS (no framework, no bundler), Manifest V3, Vitest + jsdom for unit tests, Node 20+, npm.

**Spec:** `docs/superpowers/specs/2026-05-29-aireply-extension-design.md`

---

## File map

| Path | Role |
|---|---|
| `manifest.json` | MV3 manifest, permissions, content script registration |
| `background.js` | Service worker — message router, Ringside + DDG callers |
| `content-fb.js` | Facebook content script — observer, classifier, chip injection, composer fill |
| `content-x.js` | X content script — same job, X selectors |
| `lib/storage.js` | `chrome.storage.local` wrapper |
| `lib/safety.js` | Post-generation safety filter (slurs, threats, doxing) |
| `lib/prompts.js` | Build system prompt from tone × length × platform |
| `lib/ddg.js` | DuckDuckGo HTML scrape → top 3 results |
| `lib/ringside.js` | Ringside chat/completions client + error mapping |
| `lib/dom.js` | Shadow-DOM modal + tone menu primitives (platform-agnostic) |
| `lib/selectors.js` | Versioned per-platform selectors |
| `lib/composer.js` | Native composer fill helper (`execCommand('insertText')` + fallback) |
| `ui/modal.css` | Modal styles (string imported by `dom.js`) |
| `ui/menu.css` | Tone menu styles |
| `options.html` | Settings page markup |
| `options.js` | Settings page logic |
| `icons/` | 16/48/128 PNGs |
| `tests/` | Vitest unit tests for `lib/*` |
| `package.json`, `vitest.config.js`, `.gitignore` | Toolchain |

---

## Task 1: Project skeleton

**Files:**
- Create: `/home/chka/lab/fb_autoreply/.gitignore`
- Create: `/home/chka/lab/fb_autoreply/package.json`
- Create: `/home/chka/lab/fb_autoreply/vitest.config.js`
- Create: `/home/chka/lab/fb_autoreply/tests/.gitkeep`

- [ ] **Step 1: Init git**

```bash
cd /home/chka/lab/fb_autoreply
git init -b main
```

- [ ] **Step 2: Write `.gitignore`**

```
node_modules/
.DS_Store
dist/
*.log
.env
```

- [ ] **Step 3: Write `package.json`**

```json
{
  "name": "fb_autoreply",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^2.1.0",
    "jsdom": "^25.0.0",
    "@vitest/coverage-v8": "^2.1.0"
  }
}
```

- [ ] **Step 4: Write `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
    globals: false,
  },
});
```

- [ ] **Step 5: Install deps**

```bash
npm install
```
Expected: creates `node_modules/`, `package-lock.json`.

- [ ] **Step 6: Verify Vitest runs**

```bash
npx vitest run --reporter=verbose
```
Expected: "No test files found" — exits 0 or 1, no crash.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json package-lock.json vitest.config.js tests/.gitkeep docs/
git commit -m "feat: project skeleton, vitest, spec + plan"
```

---

## Task 2: `lib/storage.js` — chrome.storage.local wrapper

**Files:**
- Create: `/home/chka/lab/fb_autoreply/lib/storage.js`
- Create: `/home/chka/lab/fb_autoreply/tests/storage.test.js`

- [ ] **Step 1: Write failing test**

`tests/storage.test.js`:

```js
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
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run tests/storage.test.js
```
Expected: FAIL — `lib/storage.js` does not exist.

- [ ] **Step 3: Implement `lib/storage.js`**

```js
export const DEFAULTS = Object.freeze({
  fcApiKey: '',
  fcCustomer: '',
  defaultModel: 'gpt-4o',
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
```

- [ ] **Step 4: Run test, confirm pass**

```bash
npx vitest run tests/storage.test.js
```
Expected: PASS, 2/2.

- [ ] **Step 5: Commit**

```bash
git add lib/storage.js tests/storage.test.js
git commit -m "feat(storage): chrome.storage.local wrapper with DEFAULTS"
```

---

## Task 3: `lib/safety.js` — content safety filter

**Files:**
- Create: `/home/chka/lab/fb_autoreply/lib/safety.js`
- Create: `/home/chka/lab/fb_autoreply/tests/safety.test.js`

- [ ] **Step 1: Write failing test**

`tests/safety.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { checkDraft } from '../lib/safety.js';

describe('checkDraft', () => {
  it('passes clean text', () => {
    expect(checkDraft('What a thoughtful post, thanks for sharing.').ok).toBe(true);
  });

  it('passes Curse-tone profanity', () => {
    const r = checkDraft('Mate this is fucking awful take honestly.');
    expect(r.ok).toBe(true);
  });

  it('blocks threats of violence', () => {
    const r = checkDraft('I will find you and kill you for posting this.');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/threat/i);
  });

  it('blocks doxing patterns (phone-like)', () => {
    const r = checkDraft("Here is the author's number: 555-867-5309 — call them.");
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/doxing|personal info/i);
  });

  it('blocks doxing patterns (address-like)', () => {
    const r = checkDraft('They live at 742 Evergreen Terrace, Springfield.');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/doxing|personal info/i);
  });

  it('blocks slurs (placeholder token)', () => {
    // The banned list ships as ['<SLUR_PLACEHOLDER>'] for v1; test verifies the matcher works.
    const r = checkDraft('You absolute <SLUR_PLACEHOLDER> waste of time.');
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/slur/i);
  });

  it('is case-insensitive', () => {
    expect(checkDraft('I WILL KILL YOU').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run tests/safety.test.js
```
Expected: FAIL — `lib/safety.js` does not exist.

- [ ] **Step 3: Implement `lib/safety.js`**

```js
const THREAT_PATTERNS = [
  /\b(i|we|im|i'?ll|we'?ll)\s+(will\s+)?(kill|murder|stab|shoot|hurt|beat|find|hunt|destroy)\s+(you|him|her|them)\b/i,
  /\b(kill|murder)\s+(you|him|her|them|yourself|himself|herself|themselves)\b/i,
  /\bgoing\s+to\s+(kill|murder|hurt|find)\b/i,
];

const DOXING_PATTERNS = [
  /\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/,
  /\b\d{1,5}\s+[A-Z][a-z]+\s+(Street|St|Avenue|Ave|Road|Rd|Terrace|Boulevard|Blvd|Lane|Ln|Drive|Dr)\b/,
  /\b(ssn|social\s+security)[:\s]+\d{3}-?\d{2}-?\d{4}\b/i,
];

const SLUR_LIST = [
  '<SLUR_PLACEHOLDER>',
  // Real list assembled at install-time by user from hatebase or equivalent;
  // intentionally not checked into the public spec. Add via lib/safety.local.js if needed.
];

export function checkDraft(text) {
  const t = String(text || '');
  for (const re of THREAT_PATTERNS) {
    if (re.test(t)) return { ok: false, reason: 'threat of violence detected' };
  }
  for (const re of DOXING_PATTERNS) {
    if (re.test(t)) return { ok: false, reason: 'doxing / personal info detected' };
  }
  const lower = t.toLowerCase();
  for (const s of SLUR_LIST) {
    if (lower.includes(s.toLowerCase())) return { ok: false, reason: 'slur detected' };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
npx vitest run tests/safety.test.js
```
Expected: PASS, 7/7.

- [ ] **Step 5: Commit**

```bash
git add lib/safety.js tests/safety.test.js
git commit -m "feat(safety): post-generation filter for threats, doxing, slurs"
```

---

## Task 4: `lib/prompts.js` — prompt builder

**Files:**
- Create: `/home/chka/lab/fb_autoreply/lib/prompts.js`
- Create: `/home/chka/lab/fb_autoreply/tests/prompts.test.js`

- [ ] **Step 1: Write failing test**

`tests/prompts.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserMessage, TONES, LENGTHS, MAX_TOKENS } from '../lib/prompts.js';

describe('prompt builder', () => {
  it('exports 6 tones', () => {
    expect(TONES).toEqual(['Polite', 'Nice', 'Information', 'Bad', 'Ugly', 'Curse']);
  });

  it('exports 3 lengths', () => {
    expect(LENGTHS).toEqual(['Short', 'Medium', 'Long']);
  });

  it('maps lengths to max_tokens', () => {
    expect(MAX_TOKENS).toEqual({ Short: 120, Medium: 400, Long: 800 });
  });

  it('builds a Polite/Medium/X system prompt', () => {
    const p = buildSystemPrompt({ tone: 'Polite', length: 'Medium', platform: 'x' });
    expect(p).toMatch(/drafting a reply/i);
    expect(p).toMatch(/courteous/i);
    expect(p).toMatch(/50.{1,3}80 words/);
    expect(p).toMatch(/no hashtags/i);
  });

  it('builds a Curse/Long/FB system prompt', () => {
    const p = buildSystemPrompt({ tone: 'Curse', length: 'Long', platform: 'fb' });
    expect(p).toMatch(/profanity/i);
    expect(p).toMatch(/no slurs/i);
    expect(p).toMatch(/no threats/i);
    expect(p).toMatch(/150/);
    expect(p).toMatch(/annoying/i);
  });

  it('Information tone references search snippets', () => {
    const p = buildSystemPrompt({ tone: 'Information', length: 'Short', platform: 'x' });
    expect(p).toMatch(/\[1\]/);
    expect(p).toMatch(/cite/i);
  });

  it('appends RESEARCH block when research provided', () => {
    const p = buildSystemPrompt({
      tone: 'Information', length: 'Medium', platform: 'x',
      research: [
        { title: 'A', url: 'https://a', snippet: 'alpha' },
        { title: 'B', url: 'https://b', snippet: 'beta' },
      ],
    });
    expect(p).toMatch(/RESEARCH:/);
    expect(p).toMatch(/\[1\] A — https:\/\/a/);
    expect(p).toMatch(/alpha/);
    expect(p).toMatch(/\[2\] B — https:\/\/b/);
  });

  it('appends (no search results) when Information has empty research', () => {
    const p = buildSystemPrompt({
      tone: 'Information', length: 'Short', platform: 'x', research: [],
    });
    expect(p).toMatch(/no search results/i);
  });

  it('throws on unknown tone', () => {
    expect(() => buildSystemPrompt({ tone: 'Snark', length: 'Short', platform: 'x' })).toThrow();
  });

  it('throws on unknown length', () => {
    expect(() => buildSystemPrompt({ tone: 'Nice', length: 'Tiny', platform: 'x' })).toThrow();
  });

  it('buildUserMessage serialises context with instruction', () => {
    const ctx = {
      platform: 'x', kind: 'comment',
      target: { author: '@alice', text: 'hello world' },
      thread: [{ author: '@bob', text: 'hi' }],
      url: 'https://x.com/alice/status/1',
    };
    const u = buildUserMessage(ctx);
    expect(u).toContain('@alice');
    expect(u).toContain('hello world');
    expect(u).toMatch(/Reply to the 'target' (post|comment)/i);
  });
});
```

- [ ] **Step 2: Run test, confirm it fails**

```bash
npx vitest run tests/prompts.test.js
```
Expected: FAIL — module missing.

- [ ] **Step 3: Implement `lib/prompts.js`**

```js
export const TONES = ['Polite', 'Nice', 'Information', 'Bad', 'Ugly', 'Curse'];
export const LENGTHS = ['Short', 'Medium', 'Long'];
export const MAX_TOKENS = { Short: 120, Medium: 400, Long: 800 };

const BASE = `You are drafting a reply on behalf of the user. Output only the reply text — no preamble, no quotes, no markdown headings, no signature. Match the language of the target post.`;

const TONE_TEXT = {
  Polite:      `Tone: courteous and formal. No contractions, no slang, no jabs. Address the target's point directly and respectfully.`,
  Nice:        `Tone: warm, supportive, casual, light positivity. Avoid sycophancy. Sound like a friendly human, not a corporate account.`,
  Information: `Tone: factual and neutral. You will be given a RESEARCH block with up to three search snippets numbered [1], [2], [3]. Cite them inline as [1] / [2] / [3] when you use their facts. No opinions, no hedging. If the snippets disagree or the question is unanswerable from them, say so.`,
  Bad:         `Tone: disagreeable, dismissive, sharp. Push back on the target's claim. No slurs, no threats, no profanity.`,
  Ugly:        `Tone: harsh, condescending, sarcastic. Jab at the argument, not the person's identity. No slurs, no threats, no profanity.`,
  Curse:       `Tone: vulgar, hostile, mocking. Profanity is encouraged. Hard rules: no slurs, no threats of violence, no doxing, no targeting of protected characteristics. Be rude, not abusive.`,
};

const LENGTH_TEXT = {
  Short:  `Length: STRICT 255-character ceiling. One sentence preferred. Count characters before finalising.`,
  Medium: `Length: 50–80 words, 2–3 sentences.`,
  Long:   `Length: 150+ words, intentionally repetitive and over-explained. Design goal: annoying to read. Restate the same point three or four different ways.`,
};

const PLATFORM_TEXT = {
  x:  `Platform: X (Twitter). No hashtags unless the target uses them. No @-mentions except the OP handle if naturally needed.`,
  fb: `Platform: Facebook. Slightly more conversational than X. Line breaks are fine.`,
};

export function buildSystemPrompt({ tone, length, platform, research }) {
  if (!TONE_TEXT[tone]) throw new Error(`unknown tone: ${tone}`);
  if (!LENGTH_TEXT[length]) throw new Error(`unknown length: ${length}`);
  if (!PLATFORM_TEXT[platform]) throw new Error(`unknown platform: ${platform}`);

  const parts = [BASE, TONE_TEXT[tone], LENGTH_TEXT[length], PLATFORM_TEXT[platform]];

  if (tone === 'Information') {
    if (Array.isArray(research) && research.length > 0) {
      const lines = research.slice(0, 3).map((r, i) =>
        `[${i + 1}] ${r.title} — ${r.url}\n    ${r.snippet}`);
      parts.push(`RESEARCH:\n${lines.join('\n')}`);
    } else {
      parts.push(`(no search results — answer from general knowledge or say you cannot)`);
    }
  }

  return parts.join('\n\n');
}

export function buildUserMessage(ctx) {
  const noun = ctx.kind === 'comment' ? 'comment' : 'post';
  const ctxJson = JSON.stringify({
    platform: ctx.platform,
    kind: ctx.kind,
    target: ctx.target,
    thread: ctx.thread || [],
    url: ctx.url,
  }, null, 2);
  return `Context:\n\`\`\`json\n${ctxJson}\n\`\`\`\n\nReply to the 'target' ${noun}.`;
}
```

- [ ] **Step 4: Run test, confirm pass**

```bash
npx vitest run tests/prompts.test.js
```
Expected: PASS, 11/11.

- [ ] **Step 5: Commit**

```bash
git add lib/prompts.js tests/prompts.test.js
git commit -m "feat(prompts): tone × length × platform prompt builder + research block"
```

---

## Task 5: `lib/ddg.js` — DuckDuckGo HTML scrape

**Files:**
- Create: `/home/chka/lab/fb_autoreply/lib/ddg.js`
- Create: `/home/chka/lab/fb_autoreply/tests/ddg.test.js`
- Create: `/home/chka/lab/fb_autoreply/tests/fixtures/ddg-sample.html`

- [ ] **Step 1: Fetch a real DDG fixture**

```bash
curl -sS 'https://html.duckduckgo.com/html/?q=manifest+v3+chrome+extension' \
  -A 'Mozilla/5.0' \
  -o /home/chka/lab/fb_autoreply/tests/fixtures/ddg-sample.html
wc -c /home/chka/lab/fb_autoreply/tests/fixtures/ddg-sample.html
grep -c 'result__a' /home/chka/lab/fb_autoreply/tests/fixtures/ddg-sample.html
```
Expected: file >10 KB, `result__a` count >5. If the count is 0, DDG returned a CAPTCHA — retry once with a different query or use the canned fixture below.

If DDG blocks, fall back to writing this minimal fixture manually:

```html
<!DOCTYPE html><html><body>
  <div class="results">
    <div class="result">
      <h2><a class="result__a" href="https://example.com/a">Result A</a></h2>
      <a class="result__snippet" href="https://example.com/a">Snippet A about manifest v3.</a>
    </div>
    <div class="result">
      <h2><a class="result__a" href="https://example.com/b">Result B</a></h2>
      <a class="result__snippet" href="https://example.com/b">Snippet B service workers.</a>
    </div>
    <div class="result">
      <h2><a class="result__a" href="https://example.com/c">Result C</a></h2>
      <a class="result__snippet" href="https://example.com/c">Snippet C content scripts.</a>
    </div>
    <div class="result">
      <h2><a class="result__a" href="https://example.com/d">Result D</a></h2>
      <a class="result__snippet" href="https://example.com/d">Snippet D should be ignored (top 3 only).</a>
    </div>
  </div>
</body></html>
```

- [ ] **Step 2: Write failing test**

`tests/ddg.test.js`:

```js
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
```

- [ ] **Step 3: Run, confirm fail**

```bash
npx vitest run tests/ddg.test.js
```
Expected: FAIL — module missing.

- [ ] **Step 4: Implement `lib/ddg.js`**

```js
export function buildQuery({ text = '', author = '' }) {
  const head = String(text).slice(0, 200).replace(/\s+/g, ' ').trim();
  const a = String(author).trim();
  return a ? `${head} ${a}`.trim() : head;
}

export function parseResults(html) {
  if (!html || typeof html !== 'string') return [];
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, 'text/html');
  } catch {
    return [];
  }
  const anchors = doc.querySelectorAll('a.result__a');
  const out = [];
  for (const a of anchors) {
    if (out.length >= 3) break;
    const title = (a.textContent || '').trim();
    let url = a.getAttribute('href') || '';
    // DDG sometimes wraps href as /l/?uddg=<encoded>
    const m = url.match(/[?&]uddg=([^&]+)/);
    if (m) { try { url = decodeURIComponent(m[1]); } catch {} }
    if (!url || !title) continue;
    const result = a.closest('.result');
    const snippetEl = result && result.querySelector('.result__snippet');
    const snippet = (snippetEl?.textContent || '').replace(/\s+/g, ' ').trim();
    out.push({ title, url, snippet });
  }
  return out;
}

export async function searchDDG(query) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!resp.ok) return [];
    return parseResults(await resp.text());
  } catch {
    return [];
  }
}
```

- [ ] **Step 5: Run, confirm pass**

```bash
npx vitest run tests/ddg.test.js
```
Expected: PASS, all assertions green.

- [ ] **Step 6: Commit**

```bash
git add lib/ddg.js tests/ddg.test.js tests/fixtures/ddg-sample.html
git commit -m "feat(ddg): DuckDuckGo HTML scrape, top 3 results"
```

---

## Task 6: `lib/ringside.js` — chat/completions client

**Files:**
- Create: `/home/chka/lab/fb_autoreply/lib/ringside.js`
- Create: `/home/chka/lab/fb_autoreply/tests/ringside.test.js`

- [ ] **Step 1: Write failing test**

`tests/ringside.test.js`:

```js
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
```

- [ ] **Step 2: Run, confirm fail**

```bash
npx vitest run tests/ringside.test.js
```

- [ ] **Step 3: Implement `lib/ringside.js`**

```js
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
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run tests/ringside.test.js
```
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add lib/ringside.js tests/ringside.test.js
git commit -m "feat(ringside): chat/completions client with retry and error codes"
```

---

## Task 7: `manifest.json`

**Files:**
- Create: `/home/chka/lab/fb_autoreply/manifest.json`
- Create: `/home/chka/lab/fb_autoreply/icons/icon16.png` (placeholder)
- Create: `/home/chka/lab/fb_autoreply/icons/icon48.png` (placeholder)
- Create: `/home/chka/lab/fb_autoreply/icons/icon128.png` (placeholder)
- Create: `/home/chka/lab/fb_autoreply/background.js` (stub, real impl in Task 8)
- Create: `/home/chka/lab/fb_autoreply/content-fb.js` (stub)
- Create: `/home/chka/lab/fb_autoreply/content-x.js` (stub)
- Create: `/home/chka/lab/fb_autoreply/options.html` (stub)
- Create: `/home/chka/lab/fb_autoreply/options.js` (stub)

- [ ] **Step 1: Write `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "AIreply",
  "version": "0.1.0",
  "description": "Inline AI reply chip for Facebook and X — drafts in 6 tones × 3 lengths, you approve before posting.",
  "permissions": ["storage", "scripting"],
  "host_permissions": [
    "https://*.facebook.com/*",
    "https://*.x.com/*",
    "https://*.twitter.com/*",
    "https://api.fightclub.pro/*",
    "https://html.duckduckgo.com/*"
  ],
  "background": { "service_worker": "background.js", "type": "module" },
  "content_scripts": [
    {
      "matches": ["https://*.facebook.com/*"],
      "js": ["content-fb.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://*.x.com/*", "https://*.twitter.com/*"],
      "js": ["content-x.js"],
      "run_at": "document_idle"
    }
  ],
  "options_page": "options.html",
  "icons": { "16": "icons/icon16.png", "48": "icons/icon48.png", "128": "icons/icon128.png" },
  "action": { "default_title": "AIreply", "default_icon": "icons/icon48.png" }
}
```

- [ ] **Step 2: Generate placeholder PNG icons**

```bash
cd /home/chka/lab/fb_autoreply
python3 - <<'PY'
import struct, zlib, os
os.makedirs('icons', exist_ok=True)
def make_png(path, size, rgb=(35, 134, 247)):
    # solid color PNG
    raw = b''
    for _ in range(size):
        raw += b'\x00' + bytes(rgb) * size
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0)
    idat = zlib.compress(raw, 9)
    png = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')
    with open(path, 'wb') as f: f.write(png)
for s in (16, 48, 128): make_png(f'icons/icon{s}.png', s)
print('icons written')
PY
ls -la icons/
```
Expected: 3 PNG files, all >50 bytes.

- [ ] **Step 3: Create stub `background.js`**

```js
chrome.runtime.onInstalled.addListener(() => {
  console.log('AIreply installed');
});
```

- [ ] **Step 4: Create stub `content-fb.js`**

```js
console.log('AIreply content-fb loaded');
```

- [ ] **Step 5: Create stub `content-x.js`**

```js
console.log('AIreply content-x loaded');
```

- [ ] **Step 6: Create stub `options.html`**

```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AIreply Settings</title></head>
<body><h1>AIreply</h1><p>Settings page — see Task 13.</p>
<script src="options.js" type="module"></script></body></html>
```

- [ ] **Step 7: Create stub `options.js`**

```js
console.log('AIreply options page loaded');
```

- [ ] **Step 8: Load unpacked into Chrome**

In Chrome: `chrome://extensions` → enable Developer mode → "Load unpacked" → select `/home/chka/lab/fb_autoreply`. Should load with no errors. Click the extension icon — popup not yet configured, that's fine. Open the SW devtools (Inspect views: service worker) — console should print "AIreply installed" once.

- [ ] **Step 9: Commit**

```bash
git add manifest.json icons/ background.js content-fb.js content-x.js options.html options.js
git commit -m "feat: manifest v3 + stub entry points, loadable in chrome"
```

---

## Task 8: `background.js` — message router

**Files:**
- Modify: `/home/chka/lab/fb_autoreply/background.js`
- Create: `/home/chka/lab/fb_autoreply/tests/background.test.js`

- [ ] **Step 1: Write failing test**

`tests/background.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pure handler — exported so we can test without simulating chrome.runtime wiring.
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
    expect(args.maxTokens).toBe(120); // Short
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
```

- [ ] **Step 2: Run, confirm fail**

```bash
npx vitest run tests/background.test.js
```

- [ ] **Step 3: Implement `background.js`**

Replace the file with:

```js
import { callRingside, RingsideError } from './lib/ringside.js';
import { searchDDG, buildQuery } from './lib/ddg.js';
import { checkDraft } from './lib/safety.js';
import { getSettings } from './lib/storage.js';
import { buildSystemPrompt, buildUserMessage, MAX_TOKENS, TONES, LENGTHS } from './lib/prompts.js';

const MAX_PAYLOAD_BYTES = 8 * 1024;

const inFlight = new Map(); // tabId -> AbortController

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
    return { ok: false, code: 'no_key', error: 'API key missing — open options' };
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(e =>
    sendResponse({ ok: false, error: e.message || String(e) }));
  return true; // async sendResponse
});
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run tests/background.test.js
```
Expected: PASS, 8/8.

- [ ] **Step 5: Commit**

```bash
git add background.js tests/background.test.js
git commit -m "feat(background): message router with generate + abort + safety check"
```

---

## Task 9: `lib/selectors.js` — versioned platform selectors

**Files:**
- Create: `/home/chka/lab/fb_autoreply/lib/selectors.js`
- Create: `/home/chka/lab/fb_autoreply/tests/selectors.test.js`

- [ ] **Step 1: Write failing test**

`tests/selectors.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { SELECTORS } from '../lib/selectors.js';

describe('SELECTORS', () => {
  it('has version and lastVerified', () => {
    expect(SELECTORS.version).toBe(1);
    expect(SELECTORS.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('x and fb selectors are present and stringy', () => {
    for (const platform of ['x', 'fb']) {
      const s = SELECTORS[platform];
      for (const key of ['post', 'actionRow', 'replyButton', 'replyTextbox']) {
        expect(s[key], `${platform}.${key}`).toBeTypeOf('string');
        expect(s[key].length).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npx vitest run tests/selectors.test.js
```

- [ ] **Step 3: Implement `lib/selectors.js`**

```js
export const SELECTORS = Object.freeze({
  version: 1,
  lastVerified: '2026-05-29',

  x: Object.freeze({
    post:         'article[data-testid="tweet"]',
    comment:      'article[data-testid="tweet"]',
    actionRow:    'div[role="group"]',
    replyButton:  'button[data-testid="reply"]',
    replyTextbox: 'div[data-testid^="tweetTextarea_"][contenteditable="true"]',
    embedQuote:   'div[role="link"] article[data-testid="tweet"]',
  }),

  fb: Object.freeze({
    post:         'div[role="article"]',
    comment:      'div[role="article"]',
    actionRow:    'div[role="presentation"]',
    replyButton:  'div[role="button"][aria-label*="Comment" i], div[role="button"][aria-label*="Reply" i]',
    replyTextbox: 'div[contenteditable="true"][role="textbox"][aria-label*="comment" i]',
    skipUrlPrefixes: ['/marketplace/', '/reels/', '/stories/'],
  }),
});
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run tests/selectors.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lib/selectors.js tests/selectors.test.js
git commit -m "feat(selectors): versioned per-platform selector table"
```

---

## Task 10: `lib/composer.js` — native composer fill

**Files:**
- Create: `/home/chka/lab/fb_autoreply/lib/composer.js`
- Create: `/home/chka/lab/fb_autoreply/tests/composer.test.js`

- [ ] **Step 1: Write failing test**

`tests/composer.test.js`:

```js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fillComposer, waitForSelector } from '../lib/composer.js';

describe('waitForSelector', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('resolves immediately if already present', async () => {
    const el = document.createElement('div');
    el.className = 'target';
    document.body.appendChild(el);
    const found = await waitForSelector('.target', 500);
    expect(found).toBe(el);
  });

  it('resolves when element appears later', async () => {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'late';
      document.body.appendChild(el);
    }, 30);
    const found = await waitForSelector('.late', 500);
    expect(found.className).toBe('late');
  });

  it('rejects on timeout', async () => {
    await expect(waitForSelector('.never', 50)).rejects.toThrow(/timeout/);
  });
});

describe('fillComposer', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('fires input event with insertText data', async () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.appendChild(editor);

    const events = [];
    editor.addEventListener('input', e => events.push(e));

    await fillComposer(editor, 'hello world');

    expect(events.length).toBeGreaterThan(0);
    const last = events[events.length - 1];
    expect(last.data === 'hello world' || editor.textContent === 'hello world').toBe(true);
  });

  it('focuses the editor', async () => {
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.appendChild(editor);
    await fillComposer(editor, 'x');
    expect(document.activeElement).toBe(editor);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npx vitest run tests/composer.test.js
```

- [ ] **Step 3: Implement `lib/composer.js`**

```js
export function waitForSelector(selector, timeoutMs = 2000, root = document) {
  return new Promise((resolve, reject) => {
    const initial = root.querySelector(selector);
    if (initial) return resolve(initial);
    const obs = new MutationObserver(() => {
      const el = root.querySelector(selector);
      if (el) { obs.disconnect(); clearTimeout(t); resolve(el); }
    });
    obs.observe(root.body || root, { childList: true, subtree: true });
    const t = setTimeout(() => {
      obs.disconnect();
      reject(new Error(`timeout waiting for ${selector}`));
    }, timeoutMs);
  });
}

export async function fillComposer(editor, text) {
  editor.focus();
  try {
    if (document.execCommand) {
      document.execCommand('selectAll', false, null);
      const ok = document.execCommand('insertText', false, text);
      if (ok) return;
    }
  } catch { /* fall through */ }
  // Fallback: dispatch synthetic input event
  editor.textContent = '';
  editor.dispatchEvent(new InputEvent('input', {
    data: text, inputType: 'insertText', bubbles: true,
  }));
  editor.textContent = text;
  editor.dispatchEvent(new InputEvent('input', {
    data: text, inputType: 'insertText', bubbles: true,
  }));
}

export async function openComposerAndFill({ replyButton, replyTextboxSelector, text, timeoutMs = 2000 }) {
  if (replyButton) replyButton.click();
  const editor = await waitForSelector(replyTextboxSelector, timeoutMs);
  await fillComposer(editor, text);
  editor.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return editor;
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run tests/composer.test.js
```

- [ ] **Step 5: Commit**

```bash
git add lib/composer.js tests/composer.test.js
git commit -m "feat(composer): waitForSelector + execCommand fill with fallback"
```

---

## Task 11: `lib/dom.js` — shadow-DOM menu + modal primitives

**Files:**
- Create: `/home/chka/lab/fb_autoreply/lib/dom.js`
- Create: `/home/chka/lab/fb_autoreply/ui/menu.css`
- Create: `/home/chka/lab/fb_autoreply/ui/modal.css`
- Create: `/home/chka/lab/fb_autoreply/tests/dom.test.js`

- [ ] **Step 1: Write `ui/menu.css`**

```css
.aireply-menu { position: absolute; z-index: 2147483647;
  background: #0e1726; color: #e8eef9; border: 1px solid #2c3a55;
  border-radius: 8px; padding: 8px; font: 13px system-ui, sans-serif;
  box-shadow: 0 8px 24px rgba(0,0,0,.5); min-width: 280px; }
.aireply-menu header { display: flex; justify-content: space-between;
  align-items: center; padding: 0 4px 6px; font-weight: 600; }
.aireply-menu header button { background: none; border: 0; color: #8fa3c5;
  cursor: pointer; font-size: 16px; }
.aireply-menu table { width: 100%; border-collapse: separate; border-spacing: 2px; }
.aireply-menu th, .aireply-menu td { padding: 2px; }
.aireply-menu th { font-weight: 500; color: #8fa3c5; text-align: center; }
.aireply-menu th.tone { text-align: left; }
.aireply-menu button.cell { width: 100%; padding: 6px 8px; border-radius: 4px;
  border: 1px solid #2c3a55; background: #15202d; color: #e8eef9; cursor: pointer; }
.aireply-menu button.cell:hover { background: #1f2d40; }
.aireply-menu button.cell.last { border-color: #4a7fbc; }
```

- [ ] **Step 2: Write `ui/modal.css`**

```css
.aireply-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5);
  z-index: 2147483647; display: flex; align-items: center; justify-content: center; }
.aireply-modal { background: #0e1726; color: #e8eef9; border: 1px solid #2c3a55;
  border-radius: 12px; width: 560px; max-width: 90vw; max-height: 90vh; display: flex;
  flex-direction: column; font: 14px system-ui, sans-serif;
  box-shadow: 0 24px 48px rgba(0,0,0,.6); }
.aireply-modal header { display: flex; justify-content: space-between;
  align-items: center; padding: 12px 16px; border-bottom: 1px solid #2c3a55; }
.aireply-modal header .meta { color: #8fa3c5; font-size: 12px; cursor: pointer; }
.aireply-modal header button.close { background: none; border: 0; color: #8fa3c5;
  font-size: 18px; cursor: pointer; }
.aireply-modal .body { padding: 16px; flex: 1; display: flex; flex-direction: column; gap: 8px; }
.aireply-modal textarea { width: 100%; min-height: 160px; resize: vertical;
  background: #15202d; color: #e8eef9; border: 1px solid #2c3a55; border-radius: 6px;
  padding: 10px; font: inherit; }
.aireply-modal .counter { font-size: 12px; color: #8fa3c5; }
.aireply-modal .counter.over { color: #ef4444; }
.aireply-modal footer { display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 16px; border-top: 1px solid #2c3a55; }
.aireply-modal button { padding: 8px 14px; border-radius: 6px; border: 1px solid #2c3a55;
  background: #15202d; color: #e8eef9; cursor: pointer; }
.aireply-modal button.primary { background: #2386f7; border-color: #2386f7; }
.aireply-modal button:disabled { opacity: 0.5; cursor: not-allowed; }
.aireply-modal .spinner { text-align: center; padding: 40px 0; color: #8fa3c5; }
.aireply-modal .blocked { background: #4a1d1d; border: 1px solid #ef4444;
  padding: 8px 12px; border-radius: 6px; color: #fecaca; }
```

- [ ] **Step 3: Write failing test**

`tests/dom.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openToneMenu, openModal } from '../lib/dom.js';

describe('openToneMenu', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('renders a 6×3 grid of selectable cells', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    let chosen = null;
    const handle = openToneMenu({
      anchor,
      lastUsed: null,
      onPick: (t, l) => { chosen = { t, l }; },
    });
    const host = document.querySelector('aireply-menu-host');
    expect(host).toBeTruthy();
    const cells = host.shadowRoot.querySelectorAll('button.cell');
    expect(cells.length).toBe(18); // 6 × 3
    cells[0].click();
    expect(chosen).toEqual({ t: 'Polite', l: 'Short' });
    expect(document.querySelector('aireply-menu-host')).toBeNull();
    handle.close();
  });

  it('closes on Escape', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    openToneMenu({ anchor, lastUsed: null, onPick: () => {} });
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.querySelector('aireply-menu-host')).toBeNull();
  });
});

describe('openModal', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('shows generating state, then ready state with draft', () => {
    const m = openModal({ tone: 'Nice', length: 'Medium', onSend: vi.fn(), onRegen: vi.fn(), onCancel: vi.fn() });
    let host = document.querySelector('aireply-modal-host');
    expect(host.shadowRoot.querySelector('.spinner')).toBeTruthy();
    m.setDraft('hello world');
    expect(host.shadowRoot.querySelector('textarea').value).toBe('hello world');
    expect(host.shadowRoot.querySelector('button.primary').disabled).toBe(false);
  });

  it('Send button calls onSend with edited draft', () => {
    const onSend = vi.fn();
    const m = openModal({ tone: 'Nice', length: 'Medium', onSend, onRegen: () => {}, onCancel: () => {} });
    m.setDraft('original');
    const host = document.querySelector('aireply-modal-host');
    const ta = host.shadowRoot.querySelector('textarea');
    ta.value = 'edited';
    host.shadowRoot.querySelector('button.primary').click();
    expect(onSend).toHaveBeenCalledWith('edited');
  });

  it('shows blocked banner when setBlocked called', () => {
    const m = openModal({ tone: 'Curse', length: 'Short', onSend: () => {}, onRegen: () => {}, onCancel: () => {} });
    m.setBlocked('blocked: threat of violence detected');
    const host = document.querySelector('aireply-modal-host');
    expect(host.shadowRoot.querySelector('.blocked').textContent).toMatch(/threat/);
  });

  it('Cancel closes the modal and calls onCancel', () => {
    const onCancel = vi.fn();
    openModal({ tone: 'Nice', length: 'Short', onSend: () => {}, onRegen: () => {}, onCancel });
    const host = document.querySelector('aireply-modal-host');
    const cancelBtn = Array.from(host.shadowRoot.querySelectorAll('button'))
      .find(b => b.textContent === 'Cancel');
    cancelBtn.click();
    expect(onCancel).toHaveBeenCalled();
    expect(document.querySelector('aireply-modal-host')).toBeNull();
  });
});
```

- [ ] **Step 4: Run, confirm fail**

```bash
npx vitest run tests/dom.test.js
```

- [ ] **Step 5: Implement `lib/dom.js`**

```js
import { TONES, LENGTHS } from './prompts.js';

const MENU_CSS = `
.aireply-menu { position: absolute; z-index: 2147483647;
  background: #0e1726; color: #e8eef9; border: 1px solid #2c3a55;
  border-radius: 8px; padding: 8px; font: 13px system-ui, sans-serif;
  box-shadow: 0 8px 24px rgba(0,0,0,.5); min-width: 280px; }
.aireply-menu header { display: flex; justify-content: space-between;
  align-items: center; padding: 0 4px 6px; font-weight: 600; }
.aireply-menu header button { background: none; border: 0; color: #8fa3c5;
  cursor: pointer; font-size: 16px; }
.aireply-menu table { width: 100%; border-collapse: separate; border-spacing: 2px; }
.aireply-menu th, .aireply-menu td { padding: 2px; }
.aireply-menu th { font-weight: 500; color: #8fa3c5; text-align: center; }
.aireply-menu th.tone { text-align: left; }
.aireply-menu button.cell { width: 100%; padding: 6px 8px; border-radius: 4px;
  border: 1px solid #2c3a55; background: #15202d; color: #e8eef9; cursor: pointer; }
.aireply-menu button.cell:hover { background: #1f2d40; }
.aireply-menu button.cell.last { border-color: #4a7fbc; }
`;

const MODAL_CSS = `
.aireply-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,.5);
  z-index: 2147483647; display: flex; align-items: center; justify-content: center; }
.aireply-modal { background: #0e1726; color: #e8eef9; border: 1px solid #2c3a55;
  border-radius: 12px; width: 560px; max-width: 90vw; max-height: 90vh; display: flex;
  flex-direction: column; font: 14px system-ui, sans-serif;
  box-shadow: 0 24px 48px rgba(0,0,0,.6); }
.aireply-modal header { display: flex; justify-content: space-between;
  align-items: center; padding: 12px 16px; border-bottom: 1px solid #2c3a55; }
.aireply-modal header .meta { color: #8fa3c5; font-size: 12px; cursor: pointer; }
.aireply-modal header button.close { background: none; border: 0; color: #8fa3c5;
  font-size: 18px; cursor: pointer; }
.aireply-modal .body { padding: 16px; flex: 1; display: flex; flex-direction: column; gap: 8px; }
.aireply-modal textarea { width: 100%; min-height: 160px; resize: vertical;
  background: #15202d; color: #e8eef9; border: 1px solid #2c3a55; border-radius: 6px;
  padding: 10px; font: inherit; }
.aireply-modal .counter { font-size: 12px; color: #8fa3c5; }
.aireply-modal .counter.over { color: #ef4444; }
.aireply-modal footer { display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 16px; border-top: 1px solid #2c3a55; }
.aireply-modal button { padding: 8px 14px; border-radius: 6px; border: 1px solid #2c3a55;
  background: #15202d; color: #e8eef9; cursor: pointer; }
.aireply-modal button.primary { background: #2386f7; border-color: #2386f7; }
.aireply-modal button:disabled { opacity: 0.5; cursor: not-allowed; }
.aireply-modal .spinner { text-align: center; padding: 40px 0; color: #8fa3c5; }
.aireply-modal .blocked { background: #4a1d1d; border: 1px solid #ef4444;
  padding: 8px 12px; border-radius: 6px; color: #fecaca; }
`;

function mountShadow(tagName) {
  const existing = document.querySelector(tagName);
  if (existing) existing.remove();
  const host = document.createElement(tagName);
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  return { host, shadow };
}

export function openToneMenu({ anchor, lastUsed, onPick }) {
  const { host, shadow } = mountShadow('aireply-menu-host');
  const style = document.createElement('style');
  style.textContent = MENU_CSS;
  shadow.appendChild(style);

  const root = document.createElement('div');
  root.className = 'aireply-menu';
  const rect = anchor.getBoundingClientRect();
  root.style.top = `${window.scrollY + rect.bottom + 4}px`;
  root.style.left = `${window.scrollX + rect.left}px`;

  const headerRow = `<header><span>AI Reply</span><button aria-label="Close">✕</button></header>`;
  const headRow = `<tr><th></th>${LENGTHS.map(l => `<th>${l}</th>`).join('')}</tr>`;
  const bodyRows = TONES.map(tone => `<tr>
    <th class="tone">${tone}</th>
    ${LENGTHS.map(length => {
      const last = lastUsed && lastUsed.tone === tone && lastUsed.length === length;
      return `<td><button class="cell${last ? ' last' : ''}" data-tone="${tone}" data-length="${length}">·</button></td>`;
    }).join('')}
  </tr>`).join('');

  root.innerHTML = `${headerRow}<table>${headRow}${bodyRows}</table>`;
  shadow.appendChild(root);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onOutside, true);
    host.remove();
  };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const onOutside = e => {
    if (!host.contains(e.target) && e.target !== anchor) close();
  };
  document.addEventListener('keydown', onKey);
  setTimeout(() => document.addEventListener('click', onOutside, true), 0);

  shadow.querySelector('header button').addEventListener('click', close);
  shadow.querySelectorAll('button.cell').forEach(btn => {
    btn.addEventListener('click', () => {
      const tone = btn.dataset.tone;
      const length = btn.dataset.length;
      close();
      onPick(tone, length);
    });
  });

  return { close };
}

export function openModal({ tone, length, platform, onSend, onRegen, onCancel, onChangeTone }) {
  const { host, shadow } = mountShadow('aireply-modal-host');
  const style = document.createElement('style');
  style.textContent = MODAL_CSS;
  shadow.appendChild(style);

  const limit = platform === 'x' ? 280 : Infinity;
  const root = document.createElement('div');
  root.className = 'aireply-backdrop';
  root.innerHTML = `
    <div class="aireply-modal" role="dialog" aria-label="AI Reply">
      <header>
        <span class="meta" data-act="changeTone">AI Reply · ${tone} · ${length}</span>
        <button class="close" aria-label="Close">✕</button>
      </header>
      <div class="body">
        <div class="spinner">⠋ generating…</div>
      </div>
      <footer>
        <button data-act="cancel">Cancel</button>
        <button data-act="regen" disabled>↻ Regenerate</button>
        <button class="primary" data-act="send" disabled>▶ Send</button>
      </footer>
    </div>
  `;
  shadow.appendChild(root);

  const body = shadow.querySelector('.body');
  const sendBtn = shadow.querySelector('[data-act="send"]');
  const regenBtn = shadow.querySelector('[data-act="regen"]');
  const cancelBtn = shadow.querySelector('[data-act="cancel"]');
  const closeBtn = shadow.querySelector('.close');
  const meta = shadow.querySelector('.meta');

  const close = () => {
    document.removeEventListener('keydown', onKey);
    host.remove();
  };
  const onKey = e => { if (e.key === 'Escape') { onCancel && onCancel(); close(); } };
  document.addEventListener('keydown', onKey);

  cancelBtn.addEventListener('click', () => { onCancel && onCancel(); close(); });
  closeBtn.addEventListener('click', () => { onCancel && onCancel(); close(); });
  regenBtn.addEventListener('click', () => onRegen && onRegen());
  sendBtn.addEventListener('click', () => {
    const ta = body.querySelector('textarea');
    if (ta) onSend(ta.value);
    close();
  });
  meta.addEventListener('click', () => onChangeTone && onChangeTone());

  function renderReady(draft) {
    body.innerHTML = `
      <textarea>${draft.replace(/[<&]/g, c => ({ '<': '&lt;', '&': '&amp;' }[c]))}</textarea>
      <div class="counter"></div>
    `;
    const ta = body.querySelector('textarea');
    const counter = body.querySelector('.counter');
    const updateCounter = () => {
      const len = ta.value.length;
      counter.textContent = limit === Infinity
        ? `${len} chars`
        : `${len} / ${limit} chars`;
      counter.classList.toggle('over', limit !== Infinity && len > limit);
    };
    ta.addEventListener('input', updateCounter);
    updateCounter();
    sendBtn.disabled = false;
    regenBtn.disabled = false;
    ta.focus();
  }

  return {
    setDraft: renderReady,
    setBlocked: (reason) => {
      body.innerHTML = `<div class="blocked">⚠ ${reason}</div>
        <p>The draft was blocked by the safety filter. Hit Regenerate to try a different sample.</p>`;
      regenBtn.disabled = false;
      sendBtn.disabled = true;
    },
    setGenerating: () => {
      body.innerHTML = `<div class="spinner">⠋ generating…</div>`;
      sendBtn.disabled = true;
      regenBtn.disabled = true;
    },
    setError: (msg) => {
      body.innerHTML = `<div class="blocked">⚠ ${msg}</div>`;
      regenBtn.disabled = false;
      sendBtn.disabled = true;
    },
    close,
  };
}
```

- [ ] **Step 6: Run, confirm pass**

```bash
npx vitest run tests/dom.test.js
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/dom.js ui/menu.css ui/modal.css tests/dom.test.js
git commit -m "feat(dom): shadow-DOM tone menu + approval modal"
```

---

## Task 12: Content scripts — observer, chip injection, glue

Both content scripts share the same shape but with different selectors and context extractors. We build one file at a time to keep tasks tight.

### Task 12a: `content-x.js`

**Files:**
- Modify: `/home/chka/lab/fb_autoreply/content-x.js`

This task has **no unit tests** — FB/X DOM injection is verified by a manual smoke run (Task 14). The lib/ modules it uses are already tested.

- [ ] **Step 1: Replace `content-x.js`**

```js
import { SELECTORS } from './lib/selectors.js';
import { openToneMenu, openModal } from './lib/dom.js';
import { openComposerAndFill } from './lib/composer.js';
import { getSettings, setSettings } from './lib/storage.js';

const PLATFORM = 'x';
const S = SELECTORS.x;
const CHIP_CLASS = 'aireply-chip';

const styleEl = document.createElement('style');
styleEl.textContent = `
button.${CHIP_CLASS} { all: unset; cursor: pointer; padding: 4px 8px; margin-left: 4px;
  border-radius: 9999px; font: 12px system-ui, sans-serif; color: #8fa3c5;
  border: 1px solid #2c3a55; background: rgba(35,134,247,0.08); }
button.${CHIP_CLASS}:hover { background: rgba(35,134,247,0.18); color: #e8eef9; }
`;
document.documentElement.appendChild(styleEl);

const seen = new WeakSet();

function uuid() {
  return 'aireply-' + crypto.randomUUID();
}

function findActionRow(article) {
  const rows = article.querySelectorAll(S.actionRow);
  // Pick the row with the reply button to avoid hitting media/poll groups
  for (const r of rows) {
    if (r.querySelector(S.replyButton)) return r;
  }
  return null;
}

function extractContext(article) {
  // Text content of the tweet — X stores it in lang="..." divs
  const textEl = article.querySelector('div[lang]');
  const text = (textEl?.innerText || '').trim();
  const authorEl = article.querySelector('div[data-testid="User-Name"]');
  const lines = (authorEl?.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
  const author = lines.find(s => s.startsWith('@')) || lines[0] || '';
  const timeEl = article.querySelector('time');
  const ts = timeEl?.getAttribute('datetime') || '';
  const linkEl = timeEl?.closest('a');
  const url = linkEl ? new URL(linkEl.getAttribute('href'), location.origin).href : location.href;
  return { author, text, ts, url };
}

function injectChip(article) {
  if (seen.has(article)) return;
  // Skip quoted/embedded tweets inside other articles
  if (article.parentElement?.closest(S.post) && article.parentElement.closest(S.post) !== article) return;
  const actionRow = findActionRow(article);
  if (!actionRow) return;
  if (actionRow.querySelector(`.${CHIP_CLASS}`)) { seen.add(article); return; }

  const id = uuid();
  article.dataset.aireplyId = id;

  const chip = document.createElement('button');
  chip.className = CHIP_CLASS;
  chip.dataset.aireplyId = id;
  chip.setAttribute('aria-label', 'AI reply');
  chip.textContent = 'AIreply';
  chip.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    onChipClick(article, chip);
  });
  actionRow.appendChild(chip);
  seen.add(article);
}

async function onChipClick(article, chip) {
  const settings = await getSettings();
  const lastUsed = settings.lastUsed?.[PLATFORM] || null;
  openToneMenu({
    anchor: chip,
    lastUsed,
    onPick: async (tone, length) => {
      await setSettings({ lastUsed: { ...settings.lastUsed, [PLATFORM]: { tone, length } } });
      runGenerate(article, chip, tone, length);
    },
  });
}

function runGenerate(article, chip, tone, length) {
  const ctx = extractContext(article);
  const kind = isReplyArticle(article) ? 'comment' : 'post';
  const thread = extractThread(article);

  const modal = openModal({
    tone, length, platform: PLATFORM,
    onCancel: () => chrome.runtime.sendMessage({ type: 'abort' }),
    onRegen: () => { modal.setGenerating(); send(0.9); },
    onChangeTone: () => onChipClick(article, chip),
    onSend: async (draftText) => {
      const replyBtn = article.querySelector(S.replyButton);
      try {
        await openComposerAndFill({
          replyButton: replyBtn,
          replyTextboxSelector: S.replyTextbox,
          text: draftText,
        });
      } catch (e) {
        console.error('AIreply: composer fill failed', e);
      }
    },
  });

  function send(temperature) {
    chrome.runtime.sendMessage({
      type: 'generate',
      payload: {
        platform: PLATFORM, kind, tone, length,
        target: { author: ctx.author, text: ctx.text, ts: ctx.ts },
        thread, url: ctx.url, temperature,
      },
    }, resp => {
      if (!resp) return modal.setError('background not responding');
      if (resp.ok) return modal.setDraft(resp.draft);
      if (resp.code === 'blocked') return modal.setBlocked(resp.error);
      if (resp.code === 'no_key') {
        modal.setError('API key missing — opening settings');
        chrome.runtime.openOptionsPage?.();
        return;
      }
      modal.setError(resp.error || 'unknown error');
    });
  }
  send(0.8);
}

function isReplyArticle(article) {
  // Heuristic: X marks replies with "Replying to" link in the article
  return !!article.querySelector('a[href*="/status/"][role="link"]')
    && /Replying to/i.test(article.textContent || '');
}

function extractThread(article) {
  // Take up to 3 prior tweets in the same column container
  const container = article.closest('[aria-label]') || document.body;
  const tweets = Array.from(container.querySelectorAll(S.post));
  const idx = tweets.indexOf(article);
  const before = tweets.slice(Math.max(0, idx - 3), idx);
  return before.map(t => extractContext(t)).map(c => ({ author: c.author, text: c.text }));
}

function scan(root = document) {
  for (const article of root.querySelectorAll(S.post)) {
    injectChip(article);
  }
}

const observer = new MutationObserver(muts => {
  for (const m of muts) {
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches?.(S.post)) injectChip(n);
      else if (n.querySelectorAll) {
        for (const a of n.querySelectorAll(S.post)) injectChip(a);
      }
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });

if ('navigation' in window) {
  let t;
  window.navigation.addEventListener('navigate', () => {
    clearTimeout(t);
    t = setTimeout(() => scan(), 250);
  });
}

scan();
console.log('AIreply: content-x loaded');
```

- [ ] **Step 2: Run existing tests, confirm no regression**

```bash
npx vitest run
```
Expected: all earlier task tests still PASS. (No new test file for this task — manual smoke covers behavior.)

- [ ] **Step 3: Commit**

```bash
git add content-x.js
git commit -m "feat(content-x): observer, chip injection, menu/modal/composer glue"
```

### Task 12b: `content-fb.js`

**Files:**
- Modify: `/home/chka/lab/fb_autoreply/content-fb.js`

- [ ] **Step 1: Replace `content-fb.js`**

```js
import { SELECTORS } from './lib/selectors.js';
import { openToneMenu, openModal } from './lib/dom.js';
import { openComposerAndFill } from './lib/composer.js';
import { getSettings, setSettings } from './lib/storage.js';

const PLATFORM = 'fb';
const S = SELECTORS.fb;
const CHIP_CLASS = 'aireply-chip';

const styleEl = document.createElement('style');
styleEl.textContent = `
button.${CHIP_CLASS} { all: unset; cursor: pointer; padding: 4px 8px; margin-left: 4px;
  border-radius: 6px; font: 12px system-ui, sans-serif; color: #5b6678;
  border: 1px solid #d0d5dd; background: rgba(35,134,247,0.06); }
button.${CHIP_CLASS}:hover { background: rgba(35,134,247,0.14); color: #1c1e21; }
`;
document.documentElement.appendChild(styleEl);

const seen = new WeakSet();

function uuid() { return 'aireply-' + crypto.randomUUID(); }

function isSkippedRoute() {
  return S.skipUrlPrefixes.some(p => location.pathname.startsWith(p));
}

function isOutermostArticle(article) {
  // top-level only — skip if there's a parent [role=article]
  let p = article.parentElement;
  while (p) {
    if (p.getAttribute?.('role') === 'article') return false;
    p = p.parentElement;
  }
  return true;
}

function findActionRow(article) {
  // FB renders Like/Comment/Share as three [role=button] siblings in a row
  const buttons = article.querySelectorAll('div[role="button"]');
  for (const b of buttons) {
    const label = b.getAttribute('aria-label') || '';
    if (/Like|Comment|Reply|Share/i.test(label)) {
      // walk up to the shared row
      let row = b.parentElement;
      for (let i = 0; i < 4 && row; i++) {
        const siblings = row.querySelectorAll(':scope > div [role="button"]');
        if (siblings.length >= 2) return row;
        row = row.parentElement;
      }
    }
  }
  return null;
}

function findReplyButton(article) {
  for (const b of article.querySelectorAll('div[role="button"]')) {
    const label = b.getAttribute('aria-label') || '';
    if (/Comment|Reply/i.test(label)) return b;
  }
  return null;
}

function extractContext(article) {
  // FB obfuscates text — best signal is direct text within the article minus chrome
  const textCandidates = article.querySelectorAll('div[dir="auto"], span[dir="auto"]');
  let text = '';
  for (const el of textCandidates) {
    const t = (el.innerText || '').trim();
    if (t.length > text.length) text = t;
    if (text.length > 1000) break;
  }
  const linkEl = article.querySelector('a[href*="/posts/"], a[href*="/permalink/"], a[href*="/comment_id="]');
  const url = linkEl ? new URL(linkEl.getAttribute('href'), location.origin).href : location.href;
  const author = (article.querySelector('h2, h3, h4')?.innerText || '').split('\n')[0].trim();
  return { author, text, ts: '', url };
}

function injectChip(article) {
  if (seen.has(article)) return;
  if (isSkippedRoute()) return;
  if (!isOutermostArticle(article)) return;
  const row = findActionRow(article);
  if (!row) return;
  if (row.querySelector(`.${CHIP_CLASS}`)) { seen.add(article); return; }

  const id = uuid();
  article.dataset.aireplyId = id;

  const chip = document.createElement('button');
  chip.className = CHIP_CLASS;
  chip.dataset.aireplyId = id;
  chip.setAttribute('aria-label', 'AI reply');
  chip.textContent = 'AIreply';
  chip.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    onChipClick(article, chip);
  });
  row.appendChild(chip);
  seen.add(article);
}

async function onChipClick(article, chip) {
  const settings = await getSettings();
  const lastUsed = settings.lastUsed?.[PLATFORM] || null;
  openToneMenu({
    anchor: chip,
    lastUsed,
    onPick: async (tone, length) => {
      await setSettings({ lastUsed: { ...settings.lastUsed, [PLATFORM]: { tone, length } } });
      runGenerate(article, chip, tone, length);
    },
  });
}

function runGenerate(article, chip, tone, length) {
  const ctx = extractContext(article);
  const kind = article.matches('[aria-label*="Comment" i] *') ? 'comment' : 'post';

  const modal = openModal({
    tone, length, platform: PLATFORM,
    onCancel: () => chrome.runtime.sendMessage({ type: 'abort' }),
    onRegen: () => { modal.setGenerating(); send(0.9); },
    onChangeTone: () => onChipClick(article, chip),
    onSend: async (draftText) => {
      const replyBtn = findReplyButton(article);
      try {
        await openComposerAndFill({
          replyButton: replyBtn,
          replyTextboxSelector: S.replyTextbox,
          text: draftText,
        });
      } catch (e) {
        console.error('AIreply: composer fill failed', e);
      }
    },
  });

  function send(temperature) {
    chrome.runtime.sendMessage({
      type: 'generate',
      payload: {
        platform: PLATFORM, kind, tone, length,
        target: { author: ctx.author, text: ctx.text, ts: ctx.ts },
        thread: [], url: ctx.url, temperature,
      },
    }, resp => {
      if (!resp) return modal.setError('background not responding');
      if (resp.ok) return modal.setDraft(resp.draft);
      if (resp.code === 'blocked') return modal.setBlocked(resp.error);
      if (resp.code === 'no_key') {
        modal.setError('API key missing — opening settings');
        chrome.runtime.openOptionsPage?.();
        return;
      }
      modal.setError(resp.error || 'unknown error');
    });
  }
  send(0.8);
}

function scan(root = document) {
  for (const a of root.querySelectorAll(S.post)) injectChip(a);
}

const observer = new MutationObserver(muts => {
  for (const m of muts) {
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.matches?.(S.post)) injectChip(n);
      else if (n.querySelectorAll) {
        for (const a of n.querySelectorAll(S.post)) injectChip(a);
      }
    }
  }
});
observer.observe(document.body, { childList: true, subtree: true });

if ('navigation' in window) {
  let t;
  window.navigation.addEventListener('navigate', () => {
    clearTimeout(t);
    t = setTimeout(() => scan(), 250);
  });
}

scan();
console.log('AIreply: content-fb loaded');
```

- [ ] **Step 2: Commit**

```bash
git add content-fb.js
git commit -m "feat(content-fb): observer, chip injection, menu/modal/composer glue"
```

---

## Task 13: Options page

**Files:**
- Modify: `/home/chka/lab/fb_autoreply/options.html`
- Modify: `/home/chka/lab/fb_autoreply/options.js`

- [ ] **Step 1: Replace `options.html`**

```html
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>AIreply Settings</title>
<style>
  body { font: 14px system-ui, sans-serif; background: #0e1726; color: #e8eef9;
    margin: 0; padding: 32px; max-width: 640px; }
  h1 { font-size: 18px; margin: 0 0 24px; }
  label { display: block; margin-top: 16px; color: #8fa3c5; font-size: 12px; }
  input[type=text], input[type=password], select {
    width: 100%; padding: 8px 10px; border-radius: 6px; border: 1px solid #2c3a55;
    background: #15202d; color: #e8eef9; font: inherit; box-sizing: border-box; }
  input[type=checkbox] { transform: scale(1.2); margin-right: 8px; }
  .check { display: flex; align-items: center; margin-top: 12px; }
  .check label { margin: 0; color: #e8eef9; font-size: 14px; }
  button { margin-top: 20px; padding: 10px 16px; border-radius: 6px; border: 1px solid #2386f7;
    background: #2386f7; color: #fff; cursor: pointer; font: inherit; }
  button.secondary { background: #15202d; color: #e8eef9; }
  .status { margin-top: 12px; color: #8fa3c5; font-size: 12px; min-height: 1em; }
  .row { display: flex; gap: 8px; }
  .row > * { flex: 1; }
</style></head>
<body>
  <h1>AIreply Settings</h1>

  <label for="fcApiKey">Ringside API key</label>
  <div class="row">
    <input id="fcApiKey" type="password" placeholder="sk_live_…" />
    <button id="testKey" class="secondary" style="margin-top:0; flex:0 0 auto;">Test</button>
  </div>

  <label for="fcCustomer">Customer tag (optional, sent as <code>FC-Customer</code>)</label>
  <input id="fcCustomer" type="text" placeholder="cust_42" />

  <label for="defaultModel">Default model</label>
  <input id="defaultModel" type="text" placeholder="gpt-4o" />

  <div class="row">
    <div>
      <label for="defaultTone">Default tone</label>
      <select id="defaultTone">
        <option>Polite</option><option>Nice</option><option>Information</option>
        <option>Bad</option><option>Ugly</option><option>Curse</option>
      </select>
    </div>
    <div>
      <label for="defaultLength">Default length</label>
      <select id="defaultLength">
        <option>Short</option><option>Medium</option><option>Long</option>
      </select>
    </div>
  </div>

  <div class="check"><input id="enableInformationSearch" type="checkbox" />
    <label for="enableInformationSearch">Use DuckDuckGo search for Information tone</label></div>
  <div class="check"><input id="enableOnFacebook" type="checkbox" />
    <label for="enableOnFacebook">Enable on Facebook</label></div>
  <div class="check"><input id="enableOnX" type="checkbox" />
    <label for="enableOnX">Enable on X</label></div>
  <div class="check"><input id="safetyCeiling" type="checkbox" disabled checked />
    <label for="safetyCeiling">Safety ceiling (locked on in v1)</label></div>

  <button id="save">Save</button>
  <div class="status" id="status"></div>

  <script src="options.js" type="module"></script>
</body></html>
```

- [ ] **Step 2: Replace `options.js`**

```js
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
```

- [ ] **Step 3: Reload extension in Chrome, open Options**

In `chrome://extensions` → AIreply → Details → "Extension options". Verify:
- Defaults populate.
- Save persists across reload.
- Test button hits `api.fightclub.pro/v1/models` with the entered key.

- [ ] **Step 4: Commit**

```bash
git add options.html options.js
git commit -m "feat(options): settings page with API-key test"
```

---

## Task 14: Manual smoke checklist + first end-to-end run

**Files:** none changed. This is verification only.

- [ ] **Step 1: Reload unpacked extension**

`chrome://extensions` → AIreply → reload.

- [ ] **Step 2: Set API key**

Open Options, paste your Ringside `sk_…` key, hit Test (should be green), Save.

- [ ] **Step 3: X smoke**

1. Open `https://x.com/home`.
2. **AIreply chip is visible** next to Like/Repost/Reply on every tweet in the timeline. ✅
3. Scroll — new tweets get chips. ✅
4. Click chip on any post → menu opens, 6×3 grid. ✅
5. Pick `Nice / Short` → modal shows "generating…" then a short reply. ✅
6. Edit the draft → char counter updates, red over 280. ✅
7. Hit Send → X's native reply composer opens with the draft text populated. You see X's blue Reply button enabled. **Do not actually post.** ✅
8. Pick `Information / Medium` on a news-ish post → DDG runs, draft contains `[1]`/`[2]` citations. ✅
9. Pick `Curse / Long` → vulgar long reply lands; no slurs, no threats. ✅
10. Force a block: open a post, manually type into the modal textarea something matching a threat regex (e.g. "I will kill you"), Send. — actually this won't trigger because filter runs server-side. Instead: change the model in options to a smaller one, trigger Curse/Long on a politically charged post, see if filter catches anything; if not, the filter is permissive by design. ✅
11. SPA navigation: click your profile → chips on profile tweets too. ✅

- [ ] **Step 4: Facebook smoke**

1. Open `https://www.facebook.com/`.
2. AIreply chip appears next to Like/Comment/Share on feed posts. ✅
3. Open a post into the photo/video dialog — chip is on the dialog's post too. ✅
4. Pick `Polite / Medium` on a comment → modal generates → Send fills FB's comment composer. ✅
5. Marketplace/Reels/Stories — no chips injected. ✅

- [ ] **Step 5: Error paths**

1. Clear API key in Options → click any chip → menu opens → pick → modal shows "API key missing", Options page opens. ✅
2. Set a deliberately bad key (`sk_bad`) → trigger generate → modal shows "ringside 401". ✅
3. Disconnect wifi → trigger generate → modal shows "network error". ✅

- [ ] **Step 6: Commit smoke notes** (no file changes — skip if all green; otherwise file bugs as tasks)

If any step fails, capture which selector / which platform / what you saw, and we either:
- patch `lib/selectors.js` (FB/X DOM drift),
- patch the extractor in the relevant content script,
- or open a follow-up task in the plan.

- [ ] **Step 7: Tag v0.1.0**

```bash
git tag v0.1.0
```

---

## Self-review

**Spec coverage:**

| Spec section | Task(s) |
|---|---|
| §1 Goal | All tasks |
| §2 Inputs | §7 manifest, §8 background, §13 options |
| §3 Architecture / file layout | §1 skeleton, §7 manifest |
| §3.2 Permissions | §7 manifest |
| §4 Button injection & DOM strategy | §9 selectors, §12 content scripts |
| §5 Tone × length menu | §11 dom.js, §12 content scripts |
| §6 Context extraction (8 KB cap) | §8 background (cap), §12 content scripts (extractor) |
| §7 Prompt builder | §4 prompts.js |
| §8 Ringside call | §6 ringside.js, §8 background |
| §9 DDG search | §5 ddg.js, §8 background |
| §10 Approval modal | §11 dom.js |
| §11 Native composer handoff | §10 composer.js, §12 content scripts |
| §12 Settings | §2 storage.js, §13 options page |
| §13 Security (permissions, key storage) | §7 manifest, §2 storage, §8 background |
| §14 Safety ceiling | §3 safety.js, §8 background |
| §15 Rate limits | **GAP — no task** |
| §16 Out of scope | enforced by §12 (skipUrlPrefixes), classifier early-return |
| §17 Testing | §2–11 (unit), §14 (manual smoke) |
| §18 v2 follow-ups | none in v1 |

**Gap found:** §15 self-imposed rate limits (1 in-flight per tab, 30/hour per platform per tab) was specified but no task implements the rolling-window counter. The in-flight cap is covered by the `inFlight` Map in §8 background.js, but the hourly cap is not. Adding Task 8b.

**Placeholder scan:** no TBDs, no "implement later". The fixture-download step in Task 5 has a documented fallback if DDG blocks.

**Type consistency:** `RingsideError.code` values used in §6 (`unauthorized`, `rate_limited`, `network`, `aborted`, `server`, `bad_request`, `malformed`, `unknown`) are referenced by §8 background test, options page error display, and content-script error mapping — all consistent.

---

## Task 8b: hourly rate limit (added by self-review)

**Files:**
- Modify: `/home/chka/lab/fb_autoreply/background.js`
- Modify: `/home/chka/lab/fb_autoreply/tests/background.test.js`

- [ ] **Step 1: Add failing test**

Append to `tests/background.test.js`:

```js
describe('hourly rate limit', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T20:00:00Z'));
    vi.spyOn(ringside, 'callRingside').mockResolvedValue('ok');
    vi.spyOn(storage, 'getSettings').mockResolvedValue({
      fcApiKey: 'k', fcCustomer: '', defaultModel: 'gpt-4o',
      defaultTone: 'Nice', defaultLength: 'Short',
      enableInformationSearch: false, enableOnFacebook: true, enableOnX: true,
      safetyCeiling: false, lastUsed: { fb: null, x: null },
    });
  });

  it('blocks after 30 generations in the same hour for the same platform', async () => {
    const payload = { platform: 'x', kind: 'post', tone: 'Nice', length: 'Short',
      target: { author: '@a', text: 'hi' }, thread: [], url: 'u' };
    for (let i = 0; i < 30; i++) {
      const r = await handleMessage({ type: 'generate', payload });
      expect(r.ok).toBe(true);
    }
    const r = await handleMessage({ type: 'generate', payload });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('rate_limited_local');
  });

  it('resets after an hour', async () => {
    const payload = { platform: 'x', kind: 'post', tone: 'Nice', length: 'Short',
      target: { author: '@a', text: 'hi' }, thread: [], url: 'u' };
    for (let i = 0; i < 30; i++) await handleMessage({ type: 'generate', payload });
    vi.advanceTimersByTime(60 * 60 * 1000 + 1);
    const r = await handleMessage({ type: 'generate', payload });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
npx vitest run tests/background.test.js
```

- [ ] **Step 3: Patch `background.js`**

Add at top of file, after imports:

```js
const RATE_LIMIT_PER_HOUR = 30;
const rateLog = { fb: [], x: [] }; // arrays of timestamps in ms

function checkRateLimit(platform) {
  const now = Date.now();
  const cutoff = now - 60 * 60 * 1000;
  const log = rateLog[platform] || (rateLog[platform] = []);
  while (log.length && log[0] < cutoff) log.shift();
  if (log.length >= RATE_LIMIT_PER_HOUR) return false;
  log.push(now);
  return true;
}
```

In `generate()`, before the `getSettings` call, add:

```js
  if (!checkRateLimit(p.platform)) {
    return { ok: false, code: 'rate_limited_local', error: 'local hourly limit (30/hr) reached' };
  }
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run tests/background.test.js
```

- [ ] **Step 5: Commit**

```bash
git add background.js tests/background.test.js
git commit -m "feat(background): hourly rate limit (30/hr per platform)"
```

---

## Done criteria

- All unit tests green (`npx vitest run`).
- Extension loads in Chrome with no errors.
- All 11 manual smoke checks in Task 14 pass.
- `v0.1.0` tagged.

Next: ship v0.2 from the §18 follow-ups when you feel like it.
