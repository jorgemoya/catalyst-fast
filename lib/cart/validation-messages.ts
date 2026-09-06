import type { ValidationMessages } from '~/domain/cart-line';
import { t } from '~/lib/i18n/messages';

/**
 * Supplies `domain/cart-line.ts` with the wording for its validation rules.
 *
 * The domain builds the schema and knows the bounds; it doesn't know English.
 * Injecting the strings here keeps `purchaseSchema` unit-testable with fixture
 * messages and keeps every user-facing string in `messages/en.json`, which is
 * what makes Phase 8 a config change rather than a sweep.
 */
export const validationMessages: ValidationMessages = {
  required: t('Cart.validation.required'),
  minLength: (min) => t('Cart.validation.minLength', { min }),
  maxLength: (max) => t('Cart.validation.maxLength', { max }),
  min: (min) => t('Cart.validation.min', { min }),
  max: (max) => t('Cart.validation.max', { max }),
  invalidDate: t('Cart.validation.invalidDate'),
};
