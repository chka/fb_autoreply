import { describe, it, expect } from 'vitest';
import { buildSystemPrompt, buildUserMessage, TONES, LENGTHS, MAX_TOKENS } from '../lib/prompts.js';

describe('prompt builder', () => {
  it('exports 6 tones', () => {
    expect(TONES).toEqual(['Polite', 'Nice', 'Information', 'Bad', 'Ugly', 'Curse']);
  });

  it('exports 3 lengths', () => {
    expect(LENGTHS).toEqual(['Short', 'Medium', 'Long']);
  });

  it('maps lengths to max_tokens', () => {
    expect(MAX_TOKENS).toEqual({ Short: 120, Medium: 400, Long: 800 });
  });

  it('builds a Polite/Medium/X system prompt', () => {
    const p = buildSystemPrompt({ tone: 'Polite', length: 'Medium', platform: 'x' });
    expect(p).toMatch(/drafting a reply/i);
    expect(p).toMatch(/courteous/i);
    expect(p).toMatch(/50.{1,3}80 words/);
    expect(p).toMatch(/no hashtags/i);
  });

  it('builds a Curse/Long/FB system prompt', () => {
    const p = buildSystemPrompt({ tone: 'Curse', length: 'Long', platform: 'fb' });
    expect(p).toMatch(/profanity/i);
    expect(p).toMatch(/no slurs/i);
    expect(p).toMatch(/no threats/i);
    expect(p).toMatch(/150/);
    expect(p).toMatch(/annoying/i);
  });

  it('Information tone references search snippets', () => {
    const p = buildSystemPrompt({ tone: 'Information', length: 'Short', platform: 'x' });
    expect(p).toMatch(/\[1\]/);
    expect(p).toMatch(/cite/i);
  });

  it('appends RESEARCH block when research provided', () => {
    const p = buildSystemPrompt({
      tone: 'Information', length: 'Medium', platform: 'x',
      research: [
        { title: 'A', url: 'https://a', snippet: 'alpha' },
        { title: 'B', url: 'https://b', snippet: 'beta' },
      ],
    });
    expect(p).toMatch(/RESEARCH:/);
    expect(p).toMatch(/\[1\] A — https:\/\/a/);
    expect(p).toMatch(/alpha/);
    expect(p).toMatch(/\[2\] B — https:\/\/b/);
  });

  it('appends (no search results) when Information has empty research', () => {
    const p = buildSystemPrompt({
      tone: 'Information', length: 'Short', platform: 'x', research: [],
    });
    expect(p).toMatch(/no search results/i);
  });

  it('throws on unknown tone', () => {
    expect(() => buildSystemPrompt({ tone: 'Snark', length: 'Short', platform: 'x' })).toThrow();
  });

  it('throws on unknown length', () => {
    expect(() => buildSystemPrompt({ tone: 'Nice', length: 'Tiny', platform: 'x' })).toThrow();
  });

  it('buildUserMessage serialises context with instruction', () => {
    const ctx = {
      platform: 'x', kind: 'comment',
      target: { author: '@alice', text: 'hello world' },
      thread: [{ author: '@bob', text: 'hi' }],
      url: 'https://x.com/alice/status/1',
    };
    const u = buildUserMessage(ctx);
    expect(u).toContain('@alice');
    expect(u).toContain('hello world');
    expect(u).toMatch(/Reply to the 'target' (post|comment)/i);
  });
});
