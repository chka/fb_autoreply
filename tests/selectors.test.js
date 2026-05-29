import { describe, it, expect } from 'vitest';
import { SELECTORS } from '../lib/selectors.js';

describe('SELECTORS', () => {
  it('has version and lastVerified', () => {
    expect(SELECTORS.version).toBe(1);
    expect(SELECTORS.lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('x and fb selectors are present and stringy', () => {
    for (const platform of ['x', 'fb']) {
      const s = SELECTORS[platform];
      for (const key of ['post', 'actionRow', 'replyButton', 'replyTextbox']) {
        expect(s[key], `${platform}.${key}`).toBeTypeOf('string');
        expect(s[key].length).toBeGreaterThan(0);
      }
    }
  });
});
