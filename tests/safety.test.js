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
