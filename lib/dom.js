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
