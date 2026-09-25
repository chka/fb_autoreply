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
      // Lexical (Facebook) syncs its selection on the async selectionchange event;
      // inserting before that fires hits a stale selection and gets reverted.
      await new Promise(r => setTimeout(r, 50));
      const ok = document.execCommand('insertText', false, text);
      if (ok) return;
    }
  } catch { /* fall through */ }
  editor.textContent = '';
  editor.dispatchEvent(new InputEvent('input', {
    data: text, inputType: 'insertText', bubbles: true,
  }));
  editor.textContent = text;
  editor.dispatchEvent(new InputEvent('input', {
    data: text, inputType: 'insertText', bubbles: true,
  }));
}

// Facebook focuses the right box ("Reply to X…" vs "Write a comment…") on click,
// while a document-wide selector lookup would grab whichever box comes first.
export function waitForFocused(selector, timeoutMs = 2000) {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      const el = document.activeElement;
      if (el && el.matches?.(selector)) return resolve(el);
      if (Date.now() - start >= timeoutMs) return resolve(null);
      setTimeout(tick, 50);
    };
    tick();
  });
}

export async function openComposerAndFill({ replyButton, replyTextboxSelector, text, timeoutMs = 2000, preferFocused = false }) {
  // Drop stale focus so only a box focused by this click can satisfy waitForFocused.
  if (preferFocused) document.activeElement?.blur?.();
  if (replyButton) replyButton.click();
  const editor = (preferFocused && await waitForFocused(replyTextboxSelector, timeoutMs))
    || await waitForSelector(replyTextboxSelector, timeoutMs);
  await fillComposer(editor, text);
  editor.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return editor;
}
