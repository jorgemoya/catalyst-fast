import { describe, expect, it } from 'vitest';

import {
  type Consent,
  hasConsentFor,
  parseCompactFormat,
  parseConsent,
  serializeConsent,
} from './consent';

describe('parseCompactFormat', () => {
  it('parses key:value pairs, coercing numbers', () => {
    expect(parseCompactFormat('i.t:123,c.necessary:1,x:abc')).toEqual({
      'i.t': 123,
      'c.necessary': 1,
      x: 'abc',
    });
  });

  it('ignores malformed pairs rather than throwing', () => {
    expect(parseCompactFormat('novalue,,c.necessary:1,:orphan')).toEqual({ 'c.necessary': 1 });
  });

  /*
   * Timestamps are milliseconds and values can contain colons in principle, so
   * the split is on the *first* colon only.
   */
  it('splits on the first colon only', () => {
    expect(parseCompactFormat('k:a:b')).toEqual({ k: 'a:b' });
  });
});

describe('parseConsent', () => {
  it('returns null for absent or empty input', () => {
    expect(parseConsent(undefined)).toBeNull();
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent('')).toBeNull();
  });

  it('returns null when the cookie is malformed', () => {
    // Missing the required `c.necessary`.
    expect(parseConsent('i.t:123')).toBeNull();
    expect(parseConsent('garbage')).toBeNull();
  });

  it('treats omitted optional categories as declined', () => {
    const consent = parseConsent('i.t:1765485149496,c.necessary:1');

    expect(consent).toEqual({
      recordedAt: 1765485149496,
      necessary: true,
      functionality: false,
      marketing: false,
      measurement: false,
    });
  });

  it('reads granted categories', () => {
    const consent = parseConsent('i.t:1765485149496,c.necessary:1,c.marketing:1,c.measurement:1');

    expect(consent?.marketing).toBe(true);
    expect(consent?.measurement).toBe(true);
    expect(consent?.functionality).toBe(false);
  });

  /*
   * The important failure direction: a corrupted value must never read as
   * consent. `c.marketing:0` is not a value we write, so it must not parse to
   * `true` by accident.
   */
  it('does not grant on unexpected values', () => {
    expect(parseConsent('i.t:1,c.necessary:1,c.marketing:0')).toBeNull();
    expect(parseConsent('i.t:1,c.necessary:1,c.marketing:yes')).toBeNull();
  });
});

describe('serializeConsent', () => {
  it('round-trips through parseConsent', () => {
    const raw = serializeConsent({ functionality: true, marketing: false, measurement: true });
    const parsed = parseConsent(raw);

    expect(parsed?.functionality).toBe(true);
    expect(parsed?.marketing).toBe(false);
    expect(parsed?.measurement).toBe(true);
  });

  it('omits declined categories entirely', () => {
    expect(serializeConsent({ functionality: false, marketing: false, measurement: false })).toMatch(
      /^i\.t:\d+,c\.necessary:1$/,
    );
  });
});

describe('hasConsentFor', () => {
  const granted: Consent = {
    recordedAt: 1,
    necessary: true,
    functionality: true,
    marketing: false,
    measurement: false,
  };

  it('permits everything when the merchant has consent disabled', () => {
    expect(hasConsentFor(null, 'marketing', false)).toBe(true);
    expect(hasConsentFor(granted, 'marketing', false)).toBe(true);
  });

  it('treats undecided as declined when consent is enabled', () => {
    expect(hasConsentFor(null, 'marketing', true)).toBe(false);
    expect(hasConsentFor(null, 'measurement', true)).toBe(false);
  });

  it('honours a recorded choice', () => {
    expect(hasConsentFor(granted, 'functionality', true)).toBe(true);
    expect(hasConsentFor(granted, 'marketing', true)).toBe(false);
  });
});
