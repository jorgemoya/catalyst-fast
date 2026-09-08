import { describe, expect, it } from 'vitest';

import {
  MAX_COMPARE_SELECTION,
  compareHref,
  parseCompareIds,
  serializeCompareIds,
  toggleCompare,
} from './compare-selection';

describe('parseCompareIds', () => {
  it('parses a comma-separated list', () => {
    expect(parseCompareIds('1,2,3')).toEqual([1, 2, 3]);
  });

  it('returns empty for absent input', () => {
    expect(parseCompareIds(undefined)).toEqual([]);
    expect(parseCompareIds('')).toEqual([]);
  });

  /*
   * `parseInt('12abc')` is 12, which would silently compare a product the
   * shopper never picked. `Number` rejects it, which is what we want.
   */
  it('drops values that are not wholly numeric', () => {
    expect(parseCompareIds('12abc,7')).toEqual([7]);
    expect(parseCompareIds('nonsense')).toEqual([]);
  });

  it('drops zero, negatives and fractions', () => {
    expect(parseCompareIds('0,-4,2.5,9')).toEqual([9]);
  });

  it('deduplicates while preserving first-seen order', () => {
    expect(parseCompareIds('3,1,3,2,1')).toEqual([3, 1, 2]);
  });

  it('clamps to the maximum', () => {
    const many = Array.from({ length: 30 }, (_, i) => i + 1).join(',');

    expect(parseCompareIds(many)).toHaveLength(MAX_COMPARE_SELECTION);
  });

  // Next gives repeated params as an array.
  it('accepts a repeated param', () => {
    expect(parseCompareIds(['1,2', '3'])).toEqual([1, 2, 3]);
  });
});

describe('serializeCompareIds / compareHref', () => {
  it('round-trips', () => {
    expect(parseCompareIds(serializeCompareIds([4, 9, 1]))).toEqual([4, 9, 1]);
  });

  it('builds a trailing-slash URL, matching the app-wide convention', () => {
    expect(compareHref([2, 5])).toBe('/compare/?ids=2,5');
  });
});

describe('toggleCompare', () => {
  it('adds and removes', () => {
    expect(toggleCompare([1, 2], 3)).toEqual([1, 2, 3]);
    expect(toggleCompare([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it('refuses to exceed the cap, without discarding the existing selection', () => {
    const full = Array.from({ length: MAX_COMPARE_SELECTION }, (_, i) => i + 1);

    expect(toggleCompare(full, 999)).toEqual(full);
  });

  it('still allows removal at the cap', () => {
    const full = Array.from({ length: MAX_COMPARE_SELECTION }, (_, i) => i + 1);

    expect(toggleCompare(full, 1)).toHaveLength(MAX_COMPARE_SELECTION - 1);
  });
});
