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
    expect(cells.length).toBe(18);
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
