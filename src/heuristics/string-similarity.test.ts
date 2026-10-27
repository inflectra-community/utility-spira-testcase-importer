import { describe, it, expect } from 'vitest';
import { levenshteinSimilarity } from './string-similarity.js';

describe('levenshteinSimilarity', () => {
  it('is 1 for identical strings', () => {
    expect(levenshteinSimilarity('priority', 'priority')).toBe(1);
  });

  it('is 1 for two empty strings', () => {
    expect(levenshteinSimilarity('', '')).toBe(1);
  });

  it('is 0 when one string is empty', () => {
    expect(levenshteinSimilarity('abc', '')).toBe(0);
    expect(levenshteinSimilarity('', 'abc')).toBe(0);
  });

  it('is high for near-identical strings', () => {
    // "priorty" vs "priority": 1 edit over 8 chars → 1 - 1/8 = 0.875
    expect(levenshteinSimilarity('priorty', 'priority')).toBeCloseTo(0.875, 3);
  });

  it('is symmetric', () => {
    expect(levenshteinSimilarity('abcd', 'abce')).toBe(levenshteinSimilarity('abce', 'abcd'));
  });

  it('is low for unrelated strings', () => {
    expect(levenshteinSimilarity('priority', 'xyzzy')).toBeLessThan(0.4);
  });

  it('stays within [0, 1]', () => {
    const pairs = [['a', 'bbbb'], ['hello', 'world'], ['', 'x'], ['same', 'same']];
    for (const [a, b] of pairs) {
      const s = levenshteinSimilarity(a, b);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});
