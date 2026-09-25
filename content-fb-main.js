import { SELECTORS } from './lib/selectors.js';
import { openToneMenu, openModal } from './lib/dom.js';
import { openComposerAndFill } from './lib/composer.js';
import { getSettings, setSettings } from './lib/storage.js';

const PLATFORM = 'fb';
const S = SELECTORS.fb;
const CHIP_CLASS = 'aireply-chip';

const styleEl = document.createElement('style');
styleEl.textContent = `
button.${CHIP_CLASS} {
  all: unset; cursor: pointer; display: inline-flex; align-items: center;
  padding: 5px 12px; margin-left: 6px; border-radius: 9999px;
  font: 600 12px/1 system-ui, -apple-system, sans-serif; letter-spacing: 0.02em;
  color: #ffffff;
  background: linear-gradient(135deg, #6366f1 0%, #a855f7 55%, #ec4899 100%);
  box-shadow: 0 1px 2px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.20);
  transition: transform .12s ease, box-shadow .15s ease, filter .15s ease;
  vertical-align: middle;
}
button.${CHIP_CLASS}:hover {
  transform: translateY(-1px);
  filter: brightness(1.06) saturate(1.05);
  box-shadow: 0 4px 12px rgba(168,85,247,.35), inset 0 1px 0 rgba(255,255,255,.25);
}
button.${CHIP_CLASS}:active {
  transform: translateY(0); filter: brightness(.95);
  box-shadow: 0 1px 2px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.12);
}
`;
document.documentElement.appendChild(styleEl);

const seen = new WeakSet();

function uuid() { return 'aireply-' + crypto.randomUUID(); }

function isSkippedRoute() {
  return S.skipUrlPrefixes.some(p => location.pathname.startsWith(p));
}

function isComment(container) {
  return container.getAttribute('role') === 'article';
}

// A post container also holds its comments (in the post dialog), so only count
// elements whose nearest post/comment container is this one.
function owned(container, el) {
  return el.closest(S.post) === container;
}

function ownedButtons(container) {
  return [...container.querySelectorAll('div[role="button"]')].filter(b => owned(container, b));
}

function findActionRow(container) {
  for (const b of ownedButtons(container)) {
    const label = b.getAttribute('aria-label') || '';
    if (/^(Like|Leave a comment|Comment|Reply)$/i.test(label)) {
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

function findReplyButton(container) {
  const buttons = ownedButtons(container);
  if (isComment(container)) {
    return buttons.find(b => (b.innerText || '').trim() === 'Reply') || null;
  }
  return buttons.find(b => b.matches(S.replyButton)) || null;
}

function extractContext(container) {
  const textCandidates = container.querySelectorAll('div[dir="auto"], span[dir="auto"]');
  let text = '';
  for (const el of textCandidates) {
    if (!owned(container, el)) continue;
    const t = (el.innerText || '').trim();
    if (t.length > text.length) text = t;
    if (text.length > 1000) break;
  }
  const linkEl = [...container.querySelectorAll('a[href*="/posts/"], a[href*="/permalink/"], a[href*="comment_id="]')]
    .find(a => owned(container, a));
  const url = linkEl ? new URL(linkEl.getAttribute('href'), location.origin).href : location.href;
  const labelAuthor = (container.getAttribute('aria-label') || '').match(/^Comment by (.+?) (?:\d+|an?|a few|just)\b/)?.[1];
  const author = labelAuthor || (container.querySelector('h2, h3, h4')?.innerText || '').split('\n')[0].trim();
  return { author, text, ts: '', url };
}

function injectChip(article) {
  if (seen.has(article)) return;
  if (isSkippedRoute()) return;
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
  const kind = isComment(article) ? 'comment' : 'post';

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
          preferFocused: true,
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
        modal.setError('API key missing - opening settings');
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

// Feed posts mount empty and hydrate later, so an added node inside an
// existing post has to re-check that post's action row.
const observer = new MutationObserver(muts => {
  for (const m of muts) {
    for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      const host = n.closest?.(S.post);
      if (host) injectChip(host);
      if (n.querySelectorAll) {
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

getSettings().then(s => {
  if (!s.enableOnFacebook) { console.log('AIreply: disabled on Facebook via settings'); return; }
  scan();
  console.log('AIreply: content-fb loaded');
});
