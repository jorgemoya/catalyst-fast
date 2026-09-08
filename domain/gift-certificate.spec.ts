import { describe, expect, it } from 'vitest';

import { computeExpiry, giftCertificateSchema } from './gift-certificate';

const messages = {
  senderNameRequired: 'sender name',
  senderEmailRequired: 'sender email',
  senderEmailInvalid: 'sender email invalid',
  recipientNameRequired: 'recipient name',
  recipientEmailRequired: 'recipient email',
  recipientEmailInvalid: 'recipient email invalid',
  amountRequired: 'amount required',
  amountRange: 'amount out of range',
  messageTooLong: 'message too long',
  termsRequired: 'terms required',
};

describe('computeExpiry', () => {
  it('adds days', () => {
    expect(computeExpiry(new Date('2026-01-10T00:00:00Z'), 5, 'DAYS').toISOString()).toContain(
      '2026-01-15',
    );
  });

  it('adds weeks', () => {
    expect(computeExpiry(new Date('2026-01-01T00:00:00Z'), 2, 'WEEKS').toISOString()).toContain(
      '2026-01-15',
    );
  });

  /*
   * The reason this is not millisecond arithmetic: adding "1 month" as 30 days
   * to January 31st gives March 2nd, and to April 30th gives May 30th. Neither
   * matches what a shopper reads as "expires in a month".
   */
  it('adds calendar months, not 30-day blocks', () => {
    expect(computeExpiry(new Date('2026-01-15T00:00:00Z'), 1, 'MONTHS').toISOString()).toContain(
      '2026-02-15',
    );
    expect(computeExpiry(new Date('2026-03-31T00:00:00Z'), 1, 'MONTHS').toISOString()).toContain(
      '2026-05-01',
    );
  });

  it('adds calendar years and handles a leap day', () => {
    expect(computeExpiry(new Date('2026-06-01T00:00:00Z'), 2, 'YEARS').toISOString()).toContain(
      '2028-06-01',
    );
    // 2028 is a leap year, 2029 is not: Feb 29 + 1 year overflows to Mar 1.
    expect(computeExpiry(new Date('2028-02-29T00:00:00Z'), 1, 'YEARS').toISOString()).toContain(
      '2029-03-01',
    );
  });

  it('does not mutate the input date', () => {
    const from = new Date('2026-01-01T00:00:00Z');

    computeExpiry(from, 1, 'YEARS');

    expect(from.toISOString()).toContain('2026-01-01');
  });
});

describe('giftCertificateSchema', () => {
  const valid = {
    amount: '50',
    senderName: 'A Sender',
    senderEmail: 'sender@example.com',
    recipientName: 'A Recipient',
    recipientEmail: 'recipient@example.com',
    theme: 'GENERAL',
    terms: 'on',
  };

  it('accepts a valid custom-amount submission', () => {
    const result = giftCertificateSchema(messages, { min: 10, max: 100 }).safeParse(valid);

    expect(result.success).toBe(true);
    expect(result.success && result.data.amount).toBe(50);
  });

  it('rejects an amount outside the range', () => {
    const schema = giftCertificateSchema(messages, { min: 10, max: 100 });

    expect(schema.safeParse({ ...valid, amount: '5' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, amount: '500' }).success).toBe(false);
  });

  /*
   * The important one. A fixed-denomination store must reject values that are
   * merely *within range* — otherwise editing the form buys an arbitrary amount
   * and BigCommerce accepts it.
   */
  it('rejects an off-list amount on a fixed-denomination store', () => {
    const schema = giftCertificateSchema(messages, {
      min: 25,
      max: 100,
      allowedAmounts: [25, 50, 100],
    });

    expect(schema.safeParse({ ...valid, amount: '50' }).success).toBe(true);
    expect(schema.safeParse({ ...valid, amount: '37.5' }).success).toBe(false);
  });

  it('requires the terms checkbox', () => {
    const schema = giftCertificateSchema(messages, { min: 10, max: 100 });
    // Built by omission rather than destructuring-and-discarding, which leaves
    // an unused binding behind.
    const withoutTerms = Object.fromEntries(
      Object.entries(valid).filter(([key]) => key !== 'terms'),
    );

    expect(schema.safeParse(withoutTerms).success).toBe(false);
  });

  it('validates both email addresses', () => {
    const schema = giftCertificateSchema(messages, { min: 10, max: 100 });

    expect(schema.safeParse({ ...valid, senderEmail: 'nope' }).success).toBe(false);
    expect(schema.safeParse({ ...valid, recipientEmail: 'nope' }).success).toBe(false);
  });

  it('enforces the 200-character message limit BigCommerce imposes', () => {
    const schema = giftCertificateSchema(messages, { min: 10, max: 100 });

    expect(schema.safeParse({ ...valid, message: 'x'.repeat(200) }).success).toBe(true);
    expect(schema.safeParse({ ...valid, message: 'x'.repeat(201) }).success).toBe(false);
  });
});
