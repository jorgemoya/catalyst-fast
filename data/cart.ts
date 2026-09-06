import { cacheLife, cacheTag } from 'next/cache';

import { type Cart, toCart } from '~/domain/cart';
import { query } from '~/lib/bigcommerce';
import {
  DigitalItemFragment,
  GiftCertificateItemFragment,
  PhysicalItemFragment,
} from '~/lib/bigcommerce/fragments/cart';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

/**
 * Cart reads, keyed by cart id.
 *
 * The cart id is a scalar argument like any other, which is what lets this sit in
 * `data/` at all: nothing here reads a cookie. The dynamic boundary — resolving
 * *which* cart belongs to this browser — happens one layer up, in the cart page
 * and the header badge. That separation is the reason the cart can be cached and
 * shared at all rather than recomputed on every request.
 *
 * `use cache: remote` with the `cart` profile (stale 30 / revalidate 60 /
 * expire 300). `stale` is deliberately far under `MIN_SHELL_STALE`, so a cart is
 * always a streamed hole and never shell content — correct, since the shell is
 * shared across shoppers and a cart is not.
 *
 * **On caching cart contents.** These entries are keyed by an unguessable cart id
 * that already functions as the capability to read and mutate that cart, and
 * which BigCommerce itself puts in the hosted-checkout URL — so the cache adds no
 * exposure the id didn't already carry. The one thing worth naming is that a
 * gift-certificate line holds a recipient's name and email, i.e. personal data
 * about someone who isn't the shopper. `expire: 300` bounds how long that sits in
 * a shared store. If a deployment's compliance posture rules that out, the fix is
 * to drop these two functions to plain dynamic reads; nothing else changes.
 */

const CartQuery = graphql(
  `
    query CartPage($cartId: String) {
      site {
        cart(entityId: $cartId) {
          entityId
          currencyCode
          isTaxIncluded
          discountedAmount {
            value
            currencyCode
          }
          lineItems {
            totalQuantity
            physicalItems {
              ...PhysicalItemFragment
            }
            digitalItems {
              ...DigitalItemFragment
            }
            giftCertificates {
              ...GiftCertificateItemFragment
            }
          }
        }
        checkout(entityId: $cartId) {
          entityId
          subtotal {
            value
            currencyCode
          }
          taxTotal {
            value
            currencyCode
          }
          grandTotal {
            value
            currencyCode
          }
          coupons {
            code
            discountedAmount {
              value
              currencyCode
            }
          }
          giftCertificates {
            code
            used {
              value
              currencyCode
            }
            balance {
              value
              currencyCode
            }
          }
        }
      }
    }
  `,
  [PhysicalItemFragment, DigitalItemFragment, GiftCertificateItemFragment],
);

/**
 * The cart page's single read. Returns `null` when BigCommerce has no such cart —
 * an expired or already-checked-out id in the cookie — which callers treat the
 * same as an empty cart.
 */
export async function getCart(cartId: string): Promise<Cart | null> {
  'use cache: remote';
  cacheLife('cart');
  cacheTag(tags.cart(cartId));

  const data = await query({ document: CartQuery, variables: { cartId } });

  if (!data.site.cart) {
    return null;
  }

  return toCart(data.site.cart, data.site.checkout ?? null);
}

const CartCountQuery = graphql(`
  query CartCount($cartId: String) {
    site {
      cart(entityId: $cartId) {
        entityId
        lineItems {
          totalQuantity
        }
      }
    }
  }
`);

/**
 * Deliberately its own query and its own cache entry rather than a field read off
 * `getCart`.
 *
 * The badge renders in the header on **every page of the site**, so reusing the
 * full cart read would drag every line item, option, and price through the cache
 * on a page that shows a single integer. This is the same "one query per
 * (cache key, cacheLife) tuple" rule applied in the other direction: two
 * consumers with genuinely different needs get two entries. Both carry
 * `tags.cart(cartId)`, so one `updateTag` still invalidates both together.
 */
export async function getCartCount(cartId: string): Promise<number | null> {
  'use cache: remote';
  cacheLife('cart');
  cacheTag(tags.cart(cartId));

  const data = await query({ document: CartCountQuery, variables: { cartId } });

  return data.site.cart?.lineItems.totalQuantity ?? null;
}
