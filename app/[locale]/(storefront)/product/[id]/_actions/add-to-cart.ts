'use server';

import { getTForAction } from '~/lib/i18n/server';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';

import { getProduct } from '~/data/product';
import { purchaseSchema, toSelectedOptionsInput } from '~/domain/cart-line';
import { toCartErrorMessage, toSubmissionErrorMessage } from '~/lib/cart/error-message';
import { addToOrCreateCart } from '~/lib/cart/mutations';
import { revalidateCart } from '~/lib/cart/revalidate';
import { validationMessages } from '~/lib/cart/validation-messages';

/**
 * Add to cart.
 *
 * The schema is rebuilt here from the catalog's own option definitions rather
 * than trusted from the submission — `getProduct` is a cached read, so it costs
 * nothing, and it means a submitted value can only ever be interpreted as the
 * kind of option BigCommerce says it is.
 *
 * Ends with `revalidateCart`, which is the `updateTag` + `refresh()` pair the
 * cart badge depends on. See `lib/cart/revalidate.ts` for why both are required.
 */

/** A form-level failure with no field to attach to. */
const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

export async function addToCart(
  productId: number,
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  const product = await getProduct(productId);

  if (!product) {
    return formError(toCartErrorMessage(t, 'add-failed'));
  }

  const submission = parseWithZod(formData, {
    schema: purchaseSchema(
      product.options,
      { min: product.minPurchaseQuantity, max: product.maxPurchaseQuantity },
      validationMessages(t),
    ),
  });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  const selectedOptions = toSelectedOptionsInput(product.options, submission.value.option);

  try {
    const cartId = await addToOrCreateCart({
      productEntityId: productId,
      quantity: submission.value.quantity,
      // Omitted entirely for a product with no options, rather than sent as an
      // empty object — BigCommerce reads `{}` as "no choices", not "not asked".
      ...(Object.keys(selectedOptions).length > 0 && { selectedOptions }),
    });

    revalidateCart(cartId);
  } catch (error) {
    // BigCommerce rejects over-max quantities and unresolvable variants as
    // GraphQL errors. Those are the shopper's to correct, so they land on the
    // form; anything else still throws.
    return submission.reply({ formErrors: [toSubmissionErrorMessage(t, error, 'add-failed')] });
  }

  return submission.reply();
}
