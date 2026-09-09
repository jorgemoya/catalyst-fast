import { z } from 'zod';

/**
 * Copy injected by the caller, matching the idiom in `cart-line`, `review` and
 * `contact`: `domain/` builds the schema and knows the rules, never the words.
 * That is what keeps it pure, unit-testable with fixtures, and free of any
 * dependency on how translation happens.
 */
export interface AddressMessages {
  required: string;
  countryCodeLength: string;
}


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
/**
 * A **factory** taking the caller's translator.
 *
 * These validation messages are translated, and a module-scope schema would be
 * evaluated once at import — pinning every locale to whichever one loaded first
 * and showing English errors to a Spanish shopper.
 */
export const addressSchema = (m: AddressMessages) =>
  z.object({
  addressEntityId: z.coerce.number().int().positive().optional(),
  firstName: z.string().trim().min(1, m.required).max(50),
  lastName: z.string().trim().min(1, m.required).max(50),
  company: z.string().trim().max(100).optional(),
  address1: z.string().trim().min(1, m.required).max(100),
  address2: z.string().trim().max(100).optional(),
  city: z.string().trim().min(1, m.required).max(50),
  stateOrProvince: z.string().trim().max(50).optional(),
  postalCode: z.string().trim().max(20).optional(),
  countryCode: z
    .string()
    .trim()
    .length(2, m.countryCodeLength)
    .transform((value) => value.toUpperCase()),
  phone: z.string().trim().max(50).optional(),
});
