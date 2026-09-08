import { z } from 'zod';

/**
 * Gift certificate purchase: expiry computation and the submission schema.
 *
 * Pure and unit-tested because the expiry arithmetic is the kind of thing that
 * looks obviously right and is off by a month.
 */

export type ExpiryUnit = 'DAYS' | 'WEEKS' | 'MONTHS' | 'YEARS';

/**
 * When a certificate purchased now would expire.
 *
 * Month and year arithmetic goes through `setMonth`/`setFullYear` rather than
 * adding milliseconds, because months are not a fixed length — "3 months" from
 * January 31st is not 90 days later, and a shopper told the wrong expiry date on
 * a gift has a real complaint.
 *
 * `setMonth` overflows deliberately and usefully: January 31st + 1 month is
 * March 3rd, not "February 31st". That is JavaScript's behaviour and it is the
 * only sane answer, but it is surprising enough to be worth stating.
 */
export function computeExpiry(from: Date, value: number, unit: ExpiryUnit): Date {
  const result = new Date(from.getTime());

  switch (unit) {
    case 'DAYS':
      result.setDate(result.getDate() + value);
      break;

    case 'WEEKS':
      result.setDate(result.getDate() + value * 7);
      break;

    case 'MONTHS':
      result.setMonth(result.getMonth() + value);
      break;

    case 'YEARS':
      result.setFullYear(result.getFullYear() + value);
      break;
  }

  return result;
}

export interface GiftCertificateMessages {
  senderNameRequired: string;
  senderEmailRequired: string;
  senderEmailInvalid: string;
  recipientNameRequired: string;
  recipientEmailRequired: string;
  recipientEmailInvalid: string;
  amountRequired: string;
  amountRange: string;
  messageTooLong: string;
  termsRequired: string;
}

/** BigCommerce hard-limits the recipient message. */
const MESSAGE_MAX = 200;

export const GIFT_CERTIFICATE_THEMES = [
  'GENERAL',
  'BIRTHDAY',
  'BOY',
  'GIRL',
  'CELEBRATION',
  'CHRISTMAS',
] as const;

export type GiftCertificateTheme = (typeof GIFT_CERTIFICATE_THEMES)[number];

interface SchemaOptions {
  /** Inclusive bounds. For a fixed-amount store, min and max are the same set. */
  min: number;
  max: number;
  /** Present only when the store uses fixed denominations. */
  allowedAmounts?: number[];
}

export function giftCertificateSchema(messages: GiftCertificateMessages, options: SchemaOptions) {
  const amount = z.coerce
    .number({
      required_error: messages.amountRequired,
      invalid_type_error: messages.amountRequired,
    })
    .refine(
      (value) => {
        /*
         * A fixed-denomination store must reject anything not on the list, not
         * merely anything out of range. Otherwise a hand-edited form field buys
         * a £37.50 certificate on a store that only sells £25 and £50 — which
         * BigCommerce accepts, because the range check passes.
         */
        if (options.allowedAmounts) {
          return options.allowedAmounts.includes(value);
        }

        return value >= options.min && value <= options.max;
      },
      { message: messages.amountRange },
    );

  return z.object({
    amount,

    senderName: z
      .string({ required_error: messages.senderNameRequired })
      .trim()
      .min(1, messages.senderNameRequired)
      .max(100),
    senderEmail: z
      .string({ required_error: messages.senderEmailRequired })
      .trim()
      .min(1, messages.senderEmailRequired)
      .email(messages.senderEmailInvalid),

    recipientName: z
      .string({ required_error: messages.recipientNameRequired })
      .trim()
      .min(1, messages.recipientNameRequired)
      .max(100),
    recipientEmail: z
      .string({ required_error: messages.recipientEmailRequired })
      .trim()
      .min(1, messages.recipientEmailRequired)
      .email(messages.recipientEmailInvalid),

    message: z.string().trim().max(MESSAGE_MAX, messages.messageTooLong).optional(),

    theme: z.enum(GIFT_CERTIFICATE_THEMES).default('GENERAL'),

    /*
     * Gift certificates are non-refundable, and on stores with an expiry
     * configured the shopper is also agreeing to that. A checkbox arrives as
     * `'on'` or is absent entirely — never `false` — so this is modelled as a
     * literal rather than a boolean.
     */
    terms: z.literal('on', { errorMap: () => ({ message: messages.termsRequired }) }),
  });
}

export type GiftCertificateInput = z.infer<ReturnType<typeof giftCertificateSchema>>;
