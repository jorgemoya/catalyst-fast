import { describe, expect, it } from 'vitest';

import {
  type ContactMessages,
  contactSchema,
  toContactFields,
  toContactSubmission,
} from './contact';

/**
 * The contact form is described once and consumed twice — by the client that
 * draws inputs and by the action that validates the submission. These tests pin
 * the description, because a drift between those two consumers shows up as a
 * form that silently drops what the shopper typed.
 */

const messages: ContactMessages = {
  required: 'REQUIRED',
  invalidEmail: 'INVALID_EMAIL',
  tooLong: (max) => `TOO_LONG:${max}`,
};

describe('toContactFields', () => {
  it('returns only the fields the merchant enabled', () => {
    expect(toContactFields(['phone']).map((f) => f.id)).toEqual(['phone']);
    expect(toContactFields([])).toEqual([]);
  });

  it('uses our render order, not BigCommerce’s response order', () => {
    expect(toContactFields(['rma', 'fullname', 'phone']).map((f) => f.id)).toEqual([
      'fullname',
      'phone',
      'rma',
    ]);
  });

  it('drops field names it does not recognize', () => {
    // A field with no slot in `SubmitContactUsDataInput` would collect input and
    // then silently discard it, which is worse than not showing it.
    expect(toContactFields(['fullname', 'favourite_colour']).map((f) => f.id)).toEqual(['fullname']);
  });
});

describe('contactSchema', () => {
  const parse = (enabled: string[], values: Record<string, string>) =>
    contactSchema(enabled, messages).safeParse(values);

  it('always requires email and comments, whatever the merchant enabled', () => {
    // Both are non-null in the mutation input and never appear in
    // `contactFields`, so they must not be merchant-toggleable.
    const result = parse([], {});

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0]).sort()).toEqual([
      'comments',
      'email',
    ]);
  });

  it('rejects a malformed email', () => {
    const result = parse([], { email: 'not-an-email', comments: 'hi' });

    expect(result.error?.issues[0]?.message).toBe('INVALID_EMAIL');
  });

  it('accepts a minimal valid submission', () => {
    expect(parse([], { email: 'a@example.com', comments: 'Hello' }).success).toBe(true);
  });

  it('treats enabled fields as optional, not required', () => {
    // `contactFields` says which fields the merchant *added*; BigCommerce has no
    // per-field required flag, so requiring them would invent a rule.
    expect(parse(['fullname', 'phone'], { email: 'a@example.com', comments: 'Hi' }).success).toBe(
      true,
    );
  });

  it('bounds field and comment length', () => {
    const long = 'x'.repeat(2001);

    expect(parse([], { email: 'a@example.com', comments: long }).error?.issues[0]?.message).toBe(
      'TOO_LONG:2000',
    );
    expect(
      parse(['fullname'], {
        email: 'a@example.com',
        comments: 'Hi',
        fullname: 'y'.repeat(251),
      }).error?.issues[0]?.message,
    ).toBe('TOO_LONG:250');
  });

  it('ignores a field the merchant did not enable', () => {
    // Not in the schema, so it is stripped rather than validated — and
    // `toContactSubmission` never reads it either.
    const result = parse([], { email: 'a@example.com', comments: 'Hi', phone: '555' });

    expect(result.success).toBe(true);
    expect(result.success && 'phone' in result.data).toBe(false);
  });
});

describe('toContactSubmission', () => {
  it('renames form fields to BigCommerce’s input names', () => {
    expect(
      toContactSubmission({
        email: 'a@example.com',
        comments: 'Hello',
        fullname: 'Ana',
        companyname: 'Acme',
        phone: '555-0100',
        orderno: '1234',
        rma: 'R-9',
      }),
    ).toEqual({
      email: 'a@example.com',
      comments: 'Hello',
      fullName: 'Ana',
      companyName: 'Acme',
      phoneNumber: '555-0100',
      orderNumber: '1234',
      rmaNumber: 'R-9',
    });
  });

  it('omits untouched optional fields rather than sending empty strings', () => {
    expect(
      toContactSubmission({ email: 'a@example.com', comments: 'Hi', fullname: '   ', phone: '' }),
    ).toEqual({ email: 'a@example.com', comments: 'Hi' });
  });

  it('trims what it keeps', () => {
    expect(
      toContactSubmission({ email: '  a@example.com  ', comments: ' Hi ', fullname: ' Ana ' }),
    ).toEqual({ email: 'a@example.com', comments: 'Hi', fullName: 'Ana' });
  });
});
