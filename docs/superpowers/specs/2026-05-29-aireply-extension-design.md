# AIreply — Chrome extension for Facebook + X reply drafting

**Date:** 2026-05-29
**Owner:** Christopher Karatzinis
**Status:** Approved design, pending implementation plan
**Repo:** `/home/chka/lab/fb_autoreply`

---

## 1. Goal

A personal-use Manifest V3 Chrome extension that adds an inline `AIreply` chip
next to the native action row of every post and comment on **facebook.com** and
**x.com** (also twitter.com). Clicking the chip opens a tone × length picker
(6 tones × 3 lengths). On selection, the extension drafts a reply via
Ringside, opens an approval modal with an editable draft, and on Send fills
the platform's native reply composer with the draft text — never auto-posts.
The human always clicks the platform's own Send.

## 2. Inputs already decided

| Decision | Value |
|---|---|
| LLM backend | Ringside (`https://api.fightclub.pro/v1`, OpenAI-compatible) |
| Auth | `Authorization: Bearer <FC_API_KEY>` + optional `FC-Customer:` header |
| API key storage | `chrome.storage.local` (sync off) |
| Targets v1 | facebook.com + x.com + twitter.com, posts + comments only |
| Button style | Small inline chip in the native action row |
| Approval UX | Modal: editable textarea + Cancel / Regenerate / Send |
| Send behaviour | Fill native composer, do NOT click native submit |
| Tones | Polite, Nice, Information, Bad, Ugly, Curse |
| Lengths | Short (≤255 chars), Medium (50–80 words), Long (150+ words, intentionally annoying) |
| Info-tone web search | DuckDuckGo HTML scrape (`html.duckduckgo.com`), top 3 results into prompt |
| Streaming | No (v1) |
| Telemetry | None |

## 3. Architecture

```
┌─ content-fb.js  ─── facebook.com/* ──────────────┐
│  - MutationObserver classifies posts/comments    │
│  - injects AI chip into action row               │
│  - mounts tone menu + approval modal             │
│  - fills native composer on Send                 │
├─ content-x.js  ─── x.com/* + twitter.com/* ──────┤    ┌─ background.js (service worker) ──┐
│  - same job, X selectors                         │ →  │  - holds FC_API_KEY in memory     │
└──────────────────────────────────────────────────┘    │  - fetch → api.fightclub.pro      │
                                                        │  - DDG scrape for Information     │
┌─ options.html / options.js ──────────────────────┐ ←  │  - normalises errors, retries 1x  │
│  - settings page (API key, model, defaults)      │    └───────────────────────────────────┘
│  - writes chrome.storage.local                   │
└──────────────────────────────────────────────────┘
```

### 3.1 File layout

```
fb_autoreply/
  manifest.json
  background.js
  content-fb.js
  content-x.js
  lib/
    ringside.js      # API client (SW only)
    prompts.js       # tone × length × platform prompt builder
    ddg.js           # DuckDuckGo HTML scrape (SW only)
    dom.js           # shadow-DOM modal + menu primitives
    selectors.js     # versioned platform selectors
    storage.js       # chrome.storage.local wrapper
    safety.js        # post-generation safety filter
  ui/
    modal.css
    menu.css
  options.html
  options.js
  icons/             # 16/48/128 png
  tests/             # unit tests for lib/*
```

### 3.2 Manifest permissions

- `storage`
- `scripting`
- `host_permissions`:
  - `https://*.facebook.com/*`
  - `https://*.x.com/*`
  - `https://*.twitter.com/*`
  - `https://api.fightclub.pro/*`
  - `https://html.duckduckgo.com/*`

No `<all_urls>`, no `tabs`, no `webRequest`, no `cookies`.

## 4. Button injection & DOM strategy

### 4.1 Detection

One document-level `MutationObserver(document.body, {childList: true, subtree: true})`
per content script. Added nodes pass through a cheap classifier
(`isPost` / `isComment`). Classified nodes get stamped with
`data-aireply-id="aireply-<uuid>"` to prevent re-processing.

Also subscribe to `navigation.addEventListener('navigate', …)` (Navigation API)
with a 250ms debounced re-scan to cover SPA route changes.

### 4.2 Selectors (anchor on role/aria, not class)

All selectors live in `lib/selectors.js`:

```js
export const SELECTORS = {
  version: 1,
  // lastVerified: 2026-05-29
  x: {
    post:         'article[data-testid="tweet"]',
    comment:      'article[data-testid="tweet"]', // X conflates these
    actionRow:    'div[role="group"]',
    replyButton:  'button[data-testid="reply"]',
    replyTextbox: 'div[data-testid^="tweetTextarea_"][contenteditable="true"]',
  },
  fb: {
    post:         'div[role="article"]',          // outermost only
    comment:      'div[role="article"]',          // nested in [aria-label*="Comment"]
    actionRow:    /* programmatic — find sibling div with [role="button"] children
                     matching Like/Comment/Share or Reply via aria-label */,
    replyButton:  'div[role="button"][aria-label*="Comment" i], div[role="button"][aria-label*="Reply" i]',
    replyTextbox: 'div[contenteditable="true"][role="textbox"][aria-label*="comment" i]',
  },
};
```

### 4.3 Chip insertion

```html
<button class="aireply-chip" data-aireply-id="aireply-<uuid>" aria-label="AI reply">
  AIreply
</button>
```

Appended to the action row. Styling injected once via a `<style>` block with
high-specificity `.aireply-chip` prefix; no frameworks, no Tailwind.

### 4.4 Edge cases handled in v1

- Quoted/embedded tweets — only outermost `article[data-testid="tweet"]`.
- "Show more replies" expansion — observer handles automatically.
- FB photo/video viewer (`[role="dialog"]`) — classifier scans inside dialogs.
- Marketplace, Groups, Reels — classifier returns null (skipped).

## 5. Tone × length menu

Closed-shadow-DOM popover anchored to the chip. 6×3 grid (tones rows × lengths
columns). Last-used `(tone, length)` per platform persisted to
`chrome.storage.local` and visually highlighted on next open.

```
┌─────────────────────────────────────────┐
│  AI Reply                          ✕   │
├─────────────────────────────────────────┤
│           Short    Medium    Long       │
│  Polite    [ ]      [ ]      [ ]        │
│  Nice      [ ]      [ ]      [ ]        │
│  Info      [ ]      [ ]      [ ]        │
│  Bad       [ ]      [ ]      [ ]        │
│  Ugly      [ ]      [ ]      [ ]        │
│  Curse     [ ]      [ ]      [ ]        │
└─────────────────────────────────────────┘
```

ESC or click-outside closes. Selection → fires API request, opens modal in
"generating" state.

## 6. Context extraction

Per request the content script sends the SW:

```json
{
  "platform": "x" | "fb",
  "kind": "post" | "comment",
  "target": { "author": "@alice", "text": "...", "ts": "ISO-8601" },
  "thread": [ { "author": "@bob", "text": "..." }, ... ],  // up to 3 ancestors
  "url": "https://x.com/alice/status/1234567890",
  "tone": "Ugly",
  "length": "Medium"
}
```

Hard cap: **8 KB total** payload. Text only; no media OCR in v1.

## 7. Prompt builder (`lib/prompts.js`)

`system = BASE + TONE[tone] + LENGTH[length] + PLATFORM_RULES[platform]`

### BASE
> You are drafting a reply on behalf of the user. Output only the reply text —
> no preamble, no quotes, no markdown headings. Match the language of the
> target post.

### TONE templates

- **Polite** — courteous, formal, no contractions, no slang, no jabs.
- **Nice** — warm, supportive, casual, light positivity, no sycophancy.
- **Information** — factual, neutral, cite the search snippets you'll be given
  inline as `[1]`, `[2]`, `[3]`. No opinions.
- **Bad** — disagreeable, dismissive, sharp tone, no slurs, no threats, no profanity.
- **Ugly** — harsh, condescending, sarcastic, personal jabs at the argument
  (not the person), no slurs, no threats, no profanity.
- **Curse** — profanity allowed and encouraged, vulgar, hostile, mocking.
  No slurs, no threats of violence, no doxing.

### LENGTH

- **Short** — strict 255-character ceiling. Single sentence preferred.
- **Medium** — 50–80 words, 2–3 sentences.
- **Long** — 150+ words, intentionally repetitive and over-explained.
  Design goal: "annoying to read". Used for trolling.

### PLATFORM_RULES

- **X** — no hashtags unless target uses them, no @-mentions except OP handle.
- **FB** — slightly more conversational, line breaks OK.

## 8. Ringside call (`lib/ringside.js`, SW only)

```
POST https://api.fightclub.pro/v1/chat/completions
Authorization: Bearer <FC_API_KEY>
FC-Customer: <FC_CUSTOMER>    (if set)
Content-Type: application/json

{
  "model":       <user default, e.g. "gpt-4o" or "claude-3-5-sonnet">,
  "messages":    [{ "role": "system", ... }, { "role": "user", ... }],
  "temperature": 0.8,
  "max_tokens":  { Short: 120, Medium: 400, Long: 800 }[length]
}
```

### Error handling

| Status | Behaviour |
|---|---|
| 401 | Toast "Check API key", open options page |
| 429 | Toast "Rate limited, try again" |
| 5xx | One silent retry, then toast |
| Network error | Toast, leave modal in regenerate state |

## 9. DuckDuckGo search (`lib/ddg.js`, SW only, Information tone only)

1. Query = first 200 chars of `target.text` + author display name.
2. `fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q))`.
3. Parse with `DOMParser`. Extract top 3 `a.result__a` (title, href,
   `.result__snippet`).
4. Prepend `RESEARCH:\n[1] ... [2] ... [3] ...` to system prompt.
5. If 0 results / parse fails → continue with `(no search results)` note.

## 10. Approval modal

Closed-shadow-DOM, `z-index: 2147483647`, ESC closes.

States: **Generating** → **Ready** → (Send | Regenerate | Cancel).

```
┌─ Ready ─────────────────────────────────┐
│  AI Reply · Ugly · Medium           ✕   │
├─────────────────────────────────────────┤
│  ┌───────────────────────────────────┐  │
│  │ [editable draft]                  │  │
│  └───────────────────────────────────┘  │
│  72 / 255 chars · model: gpt-4o         │
├─────────────────────────────────────────┤
│  [Cancel] [↻ Regenerate] [▶ Send]      │
└─────────────────────────────────────────┘
```

- Live char count, red on overflow (X = 280, FB = no limit).
- **Regenerate** = same tone/length, temperature +0.1 (cap 1.0).
- **Tone chip in header** is clickable → reopens tone menu.
- **Cancel** = close + `AbortController.abort()`, no DOM side effects.

## 11. Send: native composer handoff

The extension **never clicks the native Send**. Send means "fill the
platform's native reply composer with the draft, then close the modal".

```js
nativeReplyButton.click();                 // opens composer if needed
const editor = await waitFor(SELECTORS[platform].replyTextbox, 2000);
editor.focus();
document.execCommand('selectAll', false, null);
const ok = document.execCommand('insertText', false, draftText);
if (!ok) {
  editor.dispatchEvent(new InputEvent('input', { data: draftText, inputType: 'insertText', bubbles: true }));
}
editor.scrollIntoView({ block: 'center' });
closeModal();
```

Rationale: React-controlled `contenteditable` won't sync state from raw
`innerText` assignment. `execCommand('insertText')` fires the synthetic
`InputEvent` React listens to. Programmatic click on platform Send buttons
gets bot-flagged; human click on a populated composer is fine.

## 12. Settings (`options.html`)

| Key | Default | Notes |
|---|---|---|
| `fcApiKey` | empty | Required. Password input. "Test" button hits `/v1/models`. |
| `fcCustomer` | empty | Optional. `FC-Customer:` header. |
| `defaultModel` | `gpt-4o` | Free-text. Suggested: gpt-4o, gpt-4o-mini, claude-3-5-sonnet. |
| `defaultTone` | `Nice` | Dropdown of 6. |
| `defaultLength` | `Medium` | Dropdown of 3. |
| `enableInformationSearch` | `true` | Toggle DDG scrape for Info tone. |
| `enableOnFacebook` | `true` | Toggle FB content script. |
| `enableOnX` | `true` | Toggle X content script. |
| `safetyCeiling` | `true` (locked) | Hard floor — toggle visible but disabled in v1. |

`chrome.storage.sync` is off — key never leaves the laptop.

## 13. Security

- **API key**: lives in `chrome.storage.local`, readable only by background SW.
  Never sent to content scripts. Never reachable from page-world JS.
- **Permissions**: `storage`, `scripting`, four host patterns. Nothing else.
- **Content scraping**: post/comment text + thread ancestors only. 8 KB cap.
  No friends-list / DM / profile-data harvesting.
- **Outbound calls**: only `api.fightclub.pro` and `html.duckduckgo.com` —
  enforced by `host_permissions`.
- **No remote code**: MV3 disallows by default; no `eval`, no `new Function`,
  no remote `<script>`.
- **Threat model**: only sensitive secret is `fcApiKey`. Loss vector =
  malware reading the Chrome profile dir. Out of scope to defend against.

## 14. Safety ceiling (`lib/safety.js`)

Even Curse-tone prompts forbid: slurs, doxing, threats of violence, targeting
protected characteristics.

Post-generation filter: regex + small banned-list, runs in SW before draft
reaches modal. On trip: modal opens with `(blocked — regenerate)` banner;
offending draft never shown.

Hard floor in v1. Toggle locked on.

## 15. Self-imposed rate limits

- Max 1 in-flight Ringside call per tab.
- Max 30 generations per hour per platform per tab. Rolling-window counter
  in `chrome.storage.local`.

## 16. Out of scope (v1)

- Top-level new posts (replies only).
- Marketplace, Groups, Reels, FB Stories, X Spaces.
- Image/video understanding.
- Quote-tweet / reshare composition.
- Streaming responses.
- Cross-language translation (model picks language from BASE prompt).
- Multi-account beyond "Chrome's current logged-in user".
- Auto-posting (always human-in-the-loop).

## 17. Testing

- **Unit tests** (`tests/`): `lib/prompts.js`, `lib/ddg.js` (against fixture
  HTML), `lib/safety.js`, `lib/ringside.js` (with mocked `fetch`).
- **Manual smoke checklist** (in spec, run per release): load unpacked
  extension, walk through:
  - X post chip injection
  - X comment chip injection
  - FB post chip injection
  - FB comment chip injection
  - Each of 6 tones at Medium length
  - Each of 3 lengths at Nice tone
  - Information tone with DDG search
  - Information tone with DDG off
  - Regenerate
  - Cancel mid-generation
  - Safety ceiling trip
  - 429 error path (force with bad key)
  - SPA navigation re-scan

## 18. Open follow-ups (v2 candidates)

- Streaming responses.
- Quote-tweet composition.
- Image/video OCR fed into context.
- Image upload to ringside multimodal models.
- Real web_search via Ringside if it exposes one later.
- Move from `fcApiKey` direct to `/v1/client_tokens`-minted scoped tokens.
