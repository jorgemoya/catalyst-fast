import { z } from 'zod';

/**
 * Contact form shape, derived from the merchant's `contactFields` setting.
 *
 * BigCommerce returns a bare list of enabled optional field names. Everything
 * about how they render — order, input type, whether they're required — is ours
 * to decide, and it has to be decided identically on the server (where the
 * submission is validated) and on the client (where the inputs are drawn). So
 * this module is the single description of the form, consumed by both.
 *
 * `email` and `comments` are deliberately absent from `CONTACT_FIELDS`:
 * BigCommerce treats them as implicit and always required, and they never appear
 * in `contactFields`. Driving them from the same list would make them
 * merchant-toggleable, which would then fail the mutation — both are non-null in
 * `SubmitContactUsDataInput`.
 */

/** The optional fields BigCommerce can enable, in the order they should render. */
export const CONTACT_FIELDS = [
  { id: 'fullname', type: 'text', autoComplete: 'name' },
  { id: 'companyname', type: 'text', autoComplete: 'organization' },
  { id: 'phone', type: 'tel', autoComplete: 'tel' },
  { id: 'orderno', type: 'text', autoComplete: 'off' },
  { id: 'rma', type: 'text', autoComplete: 'off' },
] as const;

export type ContactField = (typeof CONTACT_FIELDS)[number];

const FIELD_IDS = new Set<string>(CONTACT_FIELDS.map((field) => field.id));

/**
 * Filters the merchant's list to fields we know how to render, preserving *our*
 * order rather than BigCommerce's.
 *
 * Unknown names are dropped rather than rendered as a generic text input: a field
 * we don't recognize has no place in `SubmitContactUsDataInput`, so collecting it
 * would silently discard whatever the shopper typed.
 */
export function toContactFields(enabled: readonly string[]): ContactField[] {
  const requested = new Set(enabled.filter((name) => FIELD_IDS.has(name)));

  return CONTACT_FIELDS.filter((field) => requested.has(field.id));
}

export interface ContactMessages {
  required: string;
  invalidEmail: string;
  tooLong: (max: number) => string;
}

/** Generous, but bounded — an unbounded textarea is an abuse vector. */
const MAX_COMMENT_LENGTH = 2000;
const MAX_FIELD_LENGTH = 250;

export function contactSchema(enabled: readonly string[], messages: ContactMessages) {
  const shape: Record<string, z.ZodTypeAny> = {
    email: z.string().trim().min(1, messages.required).email(messages.invalidEmail),
    comments: z
      .string()
      .trim()
      .min(1, messages.required)
      .max(MAX_COMMENT_LENGTH, messages.tooLong(MAX_COMMENT_LENGTH)),
  };

  for (const field of toContactFields(enabled)) {
    // Optional by definition — these are the fields the merchant *added*, not
    // ones they made mandatory. BigCommerce offers no per-field required flag.
    shape[field.id] = z
      .string()
      .trim()
      .max(MAX_FIELD_LENGTH, messages.tooLong(MAX_FIELD_LENGTH))
      .optional();
  }

  return z.object(shape);
}

export interface ContactSubmission {
  email: string;
  comments: string;
  fullName?: string;
  companyName?: string;
  phoneNumber?: string;
  orderNumber?: string;
  rmaNumber?: string;
}

/**
 * Maps our form names onto BigCommerce's input field names, which differ
 * (`orderno` → `orderNumber`, `rma` → `rmaNumber`). Empty strings are dropped so
 * an untouched optional field is absent rather than blank.
 */
export function toContactSubmission(values: Record<string, unknown>): ContactSubmission {
  const text = (key: string): string | undefined => {
    const value = values[key];

    return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
  };

  return {
    email: String(values.email ?? '').trim(),
    comments: String(values.comments ?? '').trim(),
    ...(text('fullname') && { fullName: text('fullname') }),
    ...(text('companyname') && { companyName: text('companyname') }),
    ...(text('phone') && { phoneNumber: text('phone') }),
    ...(text('orderno') && { orderNumber: text('orderno') }),
    ...(text('rma') && { rmaNumber: text('rma') }),
  };
}
