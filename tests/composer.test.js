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
