import 'server-only';

import type { CartSelectedOptionsInput } from '~/domain/cart-line';
import { mutate, query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';

import { CartError } from './errors';
import { getCartId, setCartId } from './session';

/**
 * Cart writes.
 *
 * All of these are guest-path: they carry the store token and no customer
 * credential, which is correct while the cart is anonymous. Once a cart is
 * assigned to a signed-in customer (Phase 6) the same mutations need that
 * customer's token and move to `customerQuery` — the shape here doesn't change,
 * only the fetcher.
 *
 * Every caller is responsible for calling `revalidateCart(cartId)` afterwards.
 * That isn't done here because these functions know nothing about rendering, and
 * `updateTag`/`refresh` are legal only inside a Server Action — putting them in
 * this module would make it unusable from the `/checkout` route handler.
 */

const CartExistsQuery = graphql(`
  query CartExists($cartId: String) {
    site {
      cart(entityId: $cartId) {
        entityId
      }
    }
  }
`);

const CreateCartMutation = graphql(`
  mutation CreateCart($input: CreateCartInput!) {
    cart {
      createCart(input: $input) {
        cart {
          entityId
        }
      }
    }
  }
`);

const AddCartLineItemsMutation = graphql(`
  mutation AddCartLineItems($input: AddCartLineItemsInput!) {
    cart {
      addCartLineItems(input: $input) {
        cart {
          entityId
        }
      }
    }
  }
`);

const UpdateCartLineItemMutation = graphql(`
  mutation UpdateCartLineItem($input: UpdateCartLineItemInput!) {
    cart {
      updateCartLineItem(input: $input) {
        cart {
          entityId
        }
      }
    }
  }
`);

const DeleteCartLineItemMutation = graphql(`
  mutation DeleteCartLineItem($input: DeleteCartLineItemInput!) {
    cart {
      deleteCartLineItem(input: $input) {
        cart {
          entityId
        }
        deletedCartEntityId
      }
    }
  }
`);

const ApplyCouponMutation = graphql(`
  mutation ApplyCheckoutCoupon($input: ApplyCheckoutCouponInput!) {
    checkout {
      applyCheckoutCoupon(input: $input) {
        checkout {
          entityId
        }
      }
    }
  }
`);

const RemoveCouponMutation = graphql(`
  mutation UnapplyCheckoutCoupon($input: UnapplyCheckoutCouponInput!) {
    checkout {
      unapplyCheckoutCoupon(input: $input) {
        checkout {
          entityId
        }
      }
    }
  }
`);

const ApplyGiftCertificateMutation = graphql(`
  mutation ApplyCheckoutGiftCertificate($input: ApplyCheckoutGiftCertificateInput!) {
    checkout {
      applyCheckoutGiftCertificate(input: $input) {
        checkout {
          entityId
        }
      }
    }
  }
`);

const RemoveGiftCertificateMutation = graphql(`
  mutation UnapplyCheckoutGiftCertificate($input: UnapplyCheckoutGiftCertificateInput!) {
    checkout {
      unapplyCheckoutGiftCertificate(input: $input) {
        checkout {
          entityId
        }
      }
    }
  }
`);

export interface CartLineInput {
  productEntityId: number;
  quantity: number;
  /**
   * Sent when known. BigCommerce can resolve the variant from `selectedOptions`
   * alone, but an update already knows which variant the line is and saying so
   * removes a resolution step that could land differently.
   */
  variantEntityId?: number;
  selectedOptions?: CartSelectedOptionsInput;
}

/**
 * Deliberately uncached, unlike everything else that reads `site.cart`.
 *
 * A cookie outlives the cart it points at: BigCommerce drops carts after 30 days
 * and consumes them at checkout, and the shopper's browser knows neither. Asking
 * the cached `getCartCount` instead would be one fewer request but could answer
 * from an entry up to 60s stale, which turns "your cart was already checked out"
 * into a failed add rather than a new cart.
 */
async function cartExists(cartId: string): Promise<boolean> {
  const data = await query({ document: CartExistsQuery, variables: { cartId } });

  return Boolean(data.site.cart);
}

/**
 * Adds a line to the shopper's cart, creating one if they don't have a live cart.
 *
 * Returns the cart id so the caller can invalidate precisely — the id may be new,
 * so an action can't assume the one it read before calling.
 */
export async function addToOrCreateCart(lineItem: CartLineInput): Promise<string> {
  const existingId = await getCartId();

  if (existingId && (await cartExists(existingId))) {
    const data = await mutate({
      document: AddCartLineItemsMutation,
      variables: { input: { cartEntityId: existingId, data: { lineItems: [lineItem] } } },
    });

    if (!data.cart.addCartLineItems?.cart?.entityId) {
      throw new CartError('add-failed');
    }

    return existingId;
  }

  const data = await mutate({
    document: CreateCartMutation,
    variables: { input: { lineItems: [lineItem] } },
  });

  const cartId = data.cart.createCart?.cart?.entityId;

  if (!cartId) {
    throw new CartError('add-failed');
  }

  // Overwrites a stale id rather than needing a separate clear.
  await setCartId(cartId);

  return cartId;
}

export async function updateLineItemQuantity(
  cartId: string,
  lineItemEntityId: string,
  lineItem: CartLineInput,
): Promise<void> {
  const data = await mutate({
    document: UpdateCartLineItemMutation,
    variables: { input: { cartEntityId: cartId, lineItemEntityId, data: { lineItem } } },
  });

  if (!data.cart.updateCartLineItem?.cart?.entityId) {
    throw new CartError('update-failed');
  }
}

/**
 * Removing the last line deletes the cart itself at BigCommerce, so the caller is
 * told to drop the cookie rather than leaving it pointing at a cart that no
 * longer exists.
 */
export async function removeLineItem(
  cartId: string,
  lineItemEntityId: string,
): Promise<{ cartDeleted: boolean }> {
  const data = await mutate({
    document: DeleteCartLineItemMutation,
    variables: { input: { cartEntityId: cartId, lineItemEntityId } },
  });

  const result = data.cart.deleteCartLineItem;

  if (!result) {
    throw new CartError('remove-failed');
  }

  return { cartDeleted: Boolean(result.deletedCartEntityId) || !result.cart };
}

/**
 * Coupons and gift certificates are applied to the *checkout*, not the cart.
 * BigCommerce gives a cart's checkout the same entity id as the cart, so callers
 * pass the cart id and never have to fetch the checkout to discover it.
 */
export async function applyCoupon(cartId: string, couponCode: string): Promise<void> {
  const data = await mutate({
    document: ApplyCouponMutation,
    variables: { input: { checkoutEntityId: cartId, data: { couponCode } } },
  });

  if (!data.checkout.applyCheckoutCoupon?.checkout?.entityId) {
    throw new CartError('coupon-failed');
  }
}

export async function removeCoupon(cartId: string, couponCode: string): Promise<void> {
  const data = await mutate({
    document: RemoveCouponMutation,
    variables: { input: { checkoutEntityId: cartId, data: { couponCode } } },
  });

  if (!data.checkout.unapplyCheckoutCoupon?.checkout?.entityId) {
    throw new CartError('coupon-failed');
  }
}

export async function applyGiftCertificate(cartId: string, giftCertificateCode: string): Promise<void> {
  const data = await mutate({
    document: ApplyGiftCertificateMutation,
    variables: { input: { checkoutEntityId: cartId, data: { giftCertificateCode } } },
  });

  if (!data.checkout.applyCheckoutGiftCertificate?.checkout?.entityId) {
    throw new CartError('gift-certificate-failed');
  }
}

export async function removeGiftCertificate(
  cartId: string,
  giftCertificateCode: string,
): Promise<void> {
  const data = await mutate({
    document: RemoveGiftCertificateMutation,
    variables: { input: { checkoutEntityId: cartId, data: { giftCertificateCode } } },
  });

  if (!data.checkout.unapplyCheckoutGiftCertificate?.checkout?.entityId) {
    throw new CartError('gift-certificate-failed');
  }
}
