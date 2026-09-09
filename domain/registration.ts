import { z } from 'zod';

/** Copy injected by the caller — see the note in `domain/address.ts`. */
export interface RegistrationMessages {
  required: string;
  invalidEmail: string;
  passwordTooShort: (min: number) => string;
  passwordMismatch: string;
}


/**
 * Registration form shape.
 *
 * **Deliberately not driven by BigCommerce's `formFields`.** Catalyst builds this
 * form dynamically from the store's customer field configuration, which is
 * genuinely more faithful — it picks up custom fields and per-store required
 * flags. It is also a large amount of machinery, and every field it can produce
 * beyond these six is optional on `RegisterCustomerInput`.
 *
 * So this covers the six fields the mutation actually requires or commonly uses,
 * and the store's own rules still apply: BigCommerce validates password
 * complexity and email uniqueness server-side and returns worded errors, which
 * the action surfaces verbatim. Dynamic custom fields remain a gap, recorded in
 * docs/phase-6-auth.md rather than half-built.
 *
 * Password length is the one rule enforced locally, purely so the shopper gets
 * immediate feedback instead of a round trip; the store's real minimum may be
 * higher and its rejection is shown as-is.
 */
const MIN_PASSWORD_LENGTH = 8;

export const registerSchema = (m: RegistrationMessages) =>
  z
    .object({
    firstName: z.string().trim().min(1, m.required).max(50),
    lastName: z.string().trim().min(1, m.required).max(50),
    email: z.string().trim().min(1, m.required).email(m.invalidEmail),
    password: z
      .string()
      .min(MIN_PASSWORD_LENGTH, m.passwordTooShort(MIN_PASSWORD_LENGTH)),
    confirmPassword: z.string().min(1, m.required),
    company: z.string().trim().max(100).optional(),
    phone: z.string().trim().max(50).optional(),

    // Present only when reCAPTCHA is configured; verified in the action.
    recaptchaToken: z.string().optional(),
  })
  // Reported against the confirmation field, not the form, so it appears next to
  // the input the shopper needs to fix.
  .refine((values) => values.password === values.confirmPassword, {
    message: m.passwordMismatch,
    path: ['confirmPassword'],
  });
