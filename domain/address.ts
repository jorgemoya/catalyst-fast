import { z } from 'zod';

import { t } from '~/lib/i18n/messages';

/**
 * Address form shape.
 *
 * `addressEntityId` is optional and is what distinguishes an edit from a create,
 * so one form, one schema, and one set of messages serve both. BigCommerce
 * rejects an id that belongs to another customer, so its presence in the form is
 * not a trust boundary.
 *
 * Only `postalCode` and `stateOrProvince` are genuinely optional at the API —
 * both are country-dependent, and hard-requiring them would break addresses in
 * the many countries that have neither.
 */
export const addressSchema = z.object({
  addressEntityId: z.coerce.number().int().positive().optional(),
  firstName: z.string().trim().min(1, t('Auth.required')).max(50),
  lastName: z.string().trim().min(1, t('Auth.required')).max(50),
  company: z.string().trim().max(100).optional(),
  address1: z.string().trim().min(1, t('Auth.required')).max(100),
  address2: z.string().trim().max(100).optional(),
  city: z.string().trim().min(1, t('Auth.required')).max(50),
  stateOrProvince: z.string().trim().max(50).optional(),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: z
    .string()
    .trim()
    .length(2, t('Account.countryCodeLength'))
    .transform((value) => value.toUpperCase()),
  phone: z.string().trim().max(50).optional(),
});
