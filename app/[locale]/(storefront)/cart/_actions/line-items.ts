'use server';

import { getTForAction } from '~/lib/i18n/server';
import type { SubmissionResult } from '@conform-to/react';

import { getCart } from '~/data/cart';
import { toCartErrorMessage, toSubmissionErrorMessage } from '~/lib/cart/error-message';
import { removeLineItem, updateLineItemQuantity } from '~/lib/cart/mutations';
import { revalidateCart } from '~/lib/cart/revalidate';
import { clearCartId, getCartId } from '~/lib/cart/session';

/**
 * Quantity and removal, as one action over one form.
 *
 * The form carries `−`/`+` buttons (`delta`), a typed quantity input
 * (`quantity`), and a remove button (`remove`). One action handles all of them so
 * that every path lands on the same "resolve target quantity, then update or
 * delete" logic — and so the whole thing works without JavaScript, which a cart
 * shouldn't need.
 *
 * **The line's identity is re-read from the server, never taken from the form.**
 * BigCommerce's `updateCartLineItem` replaces the line rather than patching it,
 * so the product, variant, and selected options have to be resent — and if those
 * came from hidden inputs, anyone could rewrite a line into a different product
 * at the price of the old one. `getCart` is a cached read, so re-deriving them
 * costs nothing.
 */

const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

function targetQuantity(formData: FormData, current: number): number {
  if (formData.get('remove') !== null) {
    return 0;
  }

  const delta = formData.get('delta');

  if (delta !== null) {
    return current + Number(delta);
  }

  const absolute = Number(formData.get('quantity'));

  return Number.isFinite(absolute) ? absolute : current;
}

export async function updateLineItem(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  const cartId = await getCartId();

  if (!cartId) {
    return formError(toCartErrorMessage(t, 'cart-not-found'));
  }

  const lineItemId = String(formData.get('lineItemId') ?? '');
  const cart = await getCart(cartId);
  const line = cart?.items.find((item) => item.id === lineItemId);

  if (!line) {
    return formError(toCartErrorMessage(t, 'line-item-not-found'));
  }

  // A gift certificate has no quantity — it is one certificate for one amount —
  // so the only operation it accepts is removal.
  if (line.kind === 'giftCertificate') {
    if (formData.get('remove') === null) {
      return formError(toCartErrorMessage(t, 'update-failed'));
    }

    try {
      const { cartDeleted } = await removeLineItem(cartId, lineItemId);

      if (cartDeleted) {
        await clearCartId();
      }

      revalidateCart(cartId);
    } catch (error) {
      return formError(toSubmissionErrorMessage(t, error, 'remove-failed'));
    }

    return { status: 'success' };
  }

  const quantity = Math.max(0, Math.trunc(targetQuantity(formData, line.quantity)));

  try {
    if (quantity === 0) {
      const { cartDeleted } = await removeLineItem(cartId, lineItemId);

      // Removing the last line deletes the cart at BigCommerce. Leaving the
      // cookie pointing at it would make the next add-to-cart pay a failed
      // lookup before recovering.
      if (cartDeleted) {
        await clearCartId();
      }
    } else {
      await updateLineItemQuantity(cartId, lineItemId, {
        productEntityId: line.productId,
        quantity,
        ...(line.variantId !== null && { variantEntityId: line.variantId }),
        ...(Object.keys(line.optionsInput).length > 0 && { selectedOptions: line.optionsInput }),
      });
    }

    revalidateCart(cartId);
  } catch (error) {
    // A quantity BigCommerce refuses — over the product's maximum, or beyond
    // available stock — is a message beside the stepper, not an error page.
    return formError(toSubmissionErrorMessage(t, error, 'update-failed'));
  }

  return { status: 'success' };
}
