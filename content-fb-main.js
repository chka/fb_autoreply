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
  let p = article.parentElement;
  while (p) {
    if (p.getAttribute?.('role') === 'article') return false;
    p = p.parentElement;
  }
  return true;
}

function findActionRow(article) {
  const buttons = article.querySelectorAll('div[role="button"]');
  for (const b of buttons) {
    const label = b.getAttribute('aria-label') || '';
    if (/Like|Comment|Reply|Share/i.test(label)) {
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
  const kind = article.closest('[aria-label*="Comment" i]') ? 'comment' : 'post';

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

getSettings().then(s => {
  if (!s.enableOnFacebook) { console.log('AIreply: disabled on Facebook via settings'); return; }
  scan();
  console.log('AIreply: content-fb loaded');
});
