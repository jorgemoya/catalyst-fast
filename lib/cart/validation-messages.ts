import type { useTranslations } from 'next-intl';
import type { ValidationMessages } from '~/domain/cart-line';

/**
 * Supplies `domain/cart-line.ts` with the wording for its validation rules.
 *
 * The domain builds the schema and knows the bounds; it doesn't know English.
 * Injecting the strings here keeps `purchaseSchema` unit-testable with fixture
 * messages and keeps every user-facing string in `messages/en.json`, which is
 * what makes Phase 8 a config change rather than a sweep.
 *
 * A **factory** taking the caller's translator, not a module constant: these
 * strings are translated, and a constant would be evaluated once at import —
 * pinning every locale to whichever one loaded first and showing English
 * validation errors to a Spanish shopper.
 */
export /** next-intl's own translator type, so a `getT()` result is assignable. */
type Translator = ReturnType<typeof useTranslations>;

export const validationMessages = (t: Translator): ValidationMessages => ({
  required: t('Cart.validation.required'),
  minLength: (min) => t('Cart.validation.minLength', { min }),
  maxLength: (max) => t('Cart.validation.maxLength', { max }),
  min: (min) => t('Cart.validation.min', { min }),
  max: (max) => t('Cart.validation.max', { max }),
  invalidDate: t('Cart.validation.invalidDate'),
});
