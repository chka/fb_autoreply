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
  for (const r of rows) {
    if (r.querySelector(S.replyButton)) return r;
  }
  return null;
}

function extractContext(article) {
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
        modal.setError('API key missing - opening settings');
        chrome.runtime.openOptionsPage?.();
        return;
      }
      modal.setError(resp.error || 'unknown error');
    });
  }
  send(0.8);
}

function isReplyArticle(article) {
  return !!article.querySelector('a[href*="/status/"][role="link"]')
    && /Replying to/i.test(article.textContent || '');
}

function extractThread(article) {
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
