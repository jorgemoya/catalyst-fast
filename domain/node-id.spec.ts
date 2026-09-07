import { describe, expect, it } from 'vitest';

import { decodeNodeId } from './node-id';

/**
 * A length-dependent bug: base64 pads with `=` only when the input length is not
 * a multiple of three, so whether a web page worked depended on the byte length
 * of `Type:entityId`. `/shipping-returns/` passed and `/contact-us/` failed.
 */
describe('decodeNodeId', () => {
  it('decodes percent-encoded base64 padding', () => {
    // `ContactPage:4` — the id that actually broke.
    expect(decodeNodeId('Q29udGFjdFBhZ2U6NA%3D%3D')).toBe('Q29udGFjdFBhZ2U6NA==');
    expect(decodeNodeId('Q29udGFjdFBhZ2U6NDE%3D')).toBe('Q29udGFjdFBhZ2U6NDE=');
  });

  it('is idempotent on an already-decoded id', () => {
    // Must be safe to apply unconditionally — base64 never contains `%`.
    expect(decodeNodeId('Q29udGFjdFBhZ2U6NA==')).toBe('Q29udGFjdFBhZ2U6NA==');
    expect(decodeNodeId('Tm9ybWFsUGFnZTox')).toBe('Tm9ybWFsUGFnZTox');
  });

  it('leaves base64url characters alone', () => {
    // `+` and `/` are meaningful in base64 and are not percent-escapes.
    expect(decodeNodeId('ab+c/d==')).toBe('ab+c/d==');
  });

  it('returns a malformed value unchanged rather than throwing', () => {
    // A bad id should 404 at BigCommerce, not crash the render.
    expect(decodeNodeId('%E0%A4%A')).toBe('%E0%A4%A');
  });
});
