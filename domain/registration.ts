import { z } from 'zod';

import {
  type CustomFormField,
  type PasswordRules,
  customFieldsSchema,
  passwordSchema,
} from './form-fields';

/** Copy injected by the caller — see the note in `domain/address.ts`. */
export interface RegistrationMessages {
  required: string;
  invalidEmail: string;
  passwordTooShort: (min: number) => string;
  passwordMismatch: string;
  passwordNeedsLowerCase: string;
  passwordNeedsUpperCase: string;
  passwordNeedsNumber: string;
  tooLong: (max: number) => string;
  invalidNumber: string;
}

/**
 * Registration form shape.
 *
 * **Built-ins hand-written, custom fields from the store.** The six built-ins are
 * required by `RegisterCustomerInput` itself and need bespoke handling —
 * confirmation matching, autocomplete hints — so generating them from
 * `formFields` would buy nothing. Everything the merchant added on top comes
 * from `data/form-fields.ts` and is merged in below.
 *
 * That second half used to be missing, and it was not free: this store has an
 * "Exclusive Offers" opt-in configured that the form simply never rendered.
 *
 * **Password rules come from the store too.** The previous hardcoded minimum of
 * 8 was *stricter* than this store's actual 7, so a password BigCommerce would
 * have accepted was rejected in the browser before it was ever tried. The
 * defaults below are BigCommerce's own floor, used only when settings are
 * unavailable.
 */
const DEFAULT_PASSWORD_RULES: PasswordRules = {
  minLength: 7,
  requireLowerCase: false,
  requireUpperCase: false,
  requireNumbers: false,
};

export const registerSchema = (
  m: RegistrationMessages,
  customFields: readonly CustomFormField[] = [],
  passwordRules: PasswordRules = DEFAULT_PASSWORD_RULES,
) =>
  z
    .object({
      firstName: z.string().trim().min(1, m.required).max(50),
      lastName: z.string().trim().min(1, m.required).max(50),
      email: z.string().trim().min(1, m.required).email(m.invalidEmail),
      password: passwordSchema(passwordRules, {
        tooShort: m.passwordTooShort,
        needsLowerCase: m.passwordNeedsLowerCase,
        needsUpperCase: m.passwordNeedsUpperCase,
        needsNumber: m.passwordNeedsNumber,
      }),
      confirmPassword: z.string().min(1, m.required),
      company: z.string().trim().max(100).optional(),
      phone: z.string().trim().max(50).optional(),

      ...customFieldsSchema(customFields, {
        required: m.required,
        tooLong: m.tooLong,
        invalidNumber: m.invalidNumber,
      }),
    })
    // Reported against the confirmation field, not the form, so it appears next
    // to the input the shopper needs to fix.
    .refine((values) => values.password === values.confirmPassword, {
      message: m.passwordMismatch,
      path: ['confirmPassword'],
    });
