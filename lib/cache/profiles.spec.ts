import { describe, expect, it } from 'vitest';

import {
  type CacheProfile,
  MIN_PREFETCHABLE_STALE,
  MIN_PRERENDERABLE_EXPIRE,
  MIN_SHELL_STALE,
  SHELL_PROFILES,
  assertProfileFloors,
  cacheProfiles,
} from './profiles';

/**
 * The `cacheLife` floors.
 *
 * These are the numbers that decide *where* content is delivered from, not how
 * fresh it is — and every failure they guard against is silent. A profile that
 * slips under `MIN_SHELL_STALE` still builds, still renders, still serves correct
 * data; it just quietly stops being in the prefetch payload, and someone notices
 * months later that clicking a link shows a skeleton.
 *
 * So the guard has to be exercised, not merely present.
 */

const valid = (overrides: Partial<CacheProfile> = {}): CacheProfile => ({
  stale: 300,
  revalidate: 900,
  expire: 86_400,
  ...overrides,
});

describe('assertProfileFloors', () => {
  it('accepts the profiles this app actually ships', () => {
    expect(() => assertProfileFloors()).not.toThrow();
  });

  it('rejects an expire below MIN_PRERENDERABLE_EXPIRE', () => {
    expect(() =>
      assertProfileFloors({ thing: valid({ expire: MIN_PRERENDERABLE_EXPIRE - 1, revalidate: 60 }) }),
    ).toThrow(/could never be prerendered/u);
  });

  it('rejects a stale below MIN_PREFETCHABLE_STALE', () => {
    expect(() => assertProfileFloors({ thing: valid({ stale: MIN_PREFETCHABLE_STALE - 1 }) })).toThrow(
      /drop out of prefetches/u,
    );
  });

  /*
   * The branch that was missing entirely until now, and the one that maps to a
   * real symptom: a shell profile dropping under 300 evicts its data from the
   * App Shell, so a prefetched link renders a skeleton instead of content.
   */
  it('rejects a shell profile whose stale falls below MIN_SHELL_STALE', () => {
    expect(() => assertProfileFloors({ product: valid({ stale: MIN_SHELL_STALE - 1 }) })).toThrow(
      /App Shell/u,
    );
  });

  it('allows a non-shell profile under MIN_SHELL_STALE, which is the whole point of the list', () => {
    // `inventory` and `cart` live below the shell floor deliberately.
    expect(() => assertProfileFloors({ inventory: valid({ stale: 60 }) })).not.toThrow();
  });

  it('rejects a revalidate longer than its expire', () => {
    expect(() =>
      assertProfileFloors({ thing: valid({ revalidate: 7200, expire: 3600 }) }),
    ).toThrow(/expire before it ever refreshed/u);
  });
});

describe('SHELL_PROFILES', () => {
  it('names only profiles that exist', () => {
    const unknown = SHELL_PROFILES.filter((name) => !(name in cacheProfiles));

    expect(unknown).toEqual([]);
  });

  /*
   * The list and the values have to agree, or the guard is checking the wrong
   * set. Every profile claiming shell membership must actually clear the floor.
   */
  it('agrees with the values: every listed profile clears the shell floor', () => {
    const below = SHELL_PROFILES.filter((name) => cacheProfiles[name].stale < MIN_SHELL_STALE);

    expect(below).toEqual([]);
  });

  it('excludes every profile that sits below the floor, so none is silently mislabelled', () => {
    const misfiled = Object.entries(cacheProfiles)
      .filter(([, profile]) => profile.stale >= MIN_SHELL_STALE)
      .filter(([name]) => !(SHELL_PROFILES as readonly string[]).includes(name))
      .map(([name]) => name);

    expect(misfiled).toEqual([]);
  });
});
