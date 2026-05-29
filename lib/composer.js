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
