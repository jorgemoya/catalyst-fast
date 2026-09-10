import { describe, expect, it } from 'vitest';

import { addressSchema } from './address';

/**
 * Fixture copy. The schema takes injected messages now, so the spec supplies
 * its own — which is the point of the injection: no translator, no locale.
 */
const t = {
  required: 'required',
  countryCodeLength: 'countryCodeLength',
  tooLong: (max: number) => `tooLong:${max}`,
  invalidNumber: 'invalidNumber',
};

const valid = {
  firstName: 'Ana',
  lastName: 'Diaz',
  address1: '1 Main St',
  city: 'Austin',
  countryCode: 'us',
};

describe('addressSchema(t)', () => {
  it('accepts a minimal address', () => {
    expect(addressSchema(t).safeParse(valid).success).toBe(true);
  });

  it('normalizes the country code to upper case', () => {
    // BigCommerce expects ISO-3166 alpha-2 upper case; a lower-case entry from a
    // shopper is a formatting difference, not an error.
    const result = addressSchema(t).safeParse(valid);

    expect(result.success && result.data.countryCode).toBe('US');
  });

  it('rejects a country code that is not two letters', () => {
    expect(addressSchema(t).safeParse({ ...valid, countryCode: 'USA' }).success).toBe(false);
  });

  it('leaves postal code and state optional', () => {
    // Both are country-dependent; requiring them would break addresses in the
    // many countries that have neither.
    const result = addressSchema(t).safeParse(valid);

    expect(result.success && result.data.postalCode).toBeUndefined();
    expect(result.success && result.data.stateOrProvince).toBeUndefined();
  });

  it('treats a present id as an edit and an absent one as a create', () => {
    expect(addressSchema(t).safeParse({ ...valid, addressEntityId: '12' }).success).toBe(true);
    const created = addressSchema(t).safeParse(valid);

    expect(created.success && created.data.addressEntityId).toBeUndefined();
  });

  it('rejects a non-positive address id', () => {
    expect(addressSchema(t).safeParse({ ...valid, addressEntityId: '0' }).success).toBe(false);
    expect(addressSchema(t).safeParse({ ...valid, addressEntityId: '-3' }).success).toBe(false);
  });
});
