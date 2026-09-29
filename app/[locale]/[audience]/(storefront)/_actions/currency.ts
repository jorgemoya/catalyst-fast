'use server';

import { refresh } from 'next/cache';
import { cookies } from 'next/headers';

import { resolveCurrency } from '~/lib/config/channels';
import { getSwitchableCurrencies } from '~/data/currencies';
import { updateCartCurrency } from '~/lib/cart/mutations';
import { revalidateCart } from '~/lib/cart/revalidate';
import { getCartId, setCartId } from '~/lib/cart/session';
import { CURRENCY_COOKIE, activeLocale, hasFunctionalityConsent } from '~/lib/currency';

/**
 * Switches the display currency.
 *
 * **Catalog prices are never invalidated here**, and that distinction is the
 * whole design. Switching currency changes which cache key this shopper reads,
 * not the validity of any entry — the USD entries stay correct and stay wanted
 * by every other shopper. `updateTag(tags.prices)` would evict the entire
 * store's pricing because one person wanted euros.
 *
 * `refresh()` is what makes the switch visible: the currency lives in a cookie
 * read by `'use cache: private'` scopes, and those live in the browser, where a
 * server-side invalidation cannot reach them even in principle.
 *
 * **The cart is the exception.** It is a real BigCommerce entity with its own
 * currency, so it is genuinely mutated and its own tag genuinely is invalidated
 * — `revalidateCart` at the end. That is one shopper's cart, not shared pricing,
 * so the objection above does not apply to it.
 */
export async function setCurrency(currency: string): Promise<void> {
  const locale = await activeLocale();

  /*
   * Validated against what BigCommerce reports as transactional: the value
   * arrives from a client component and ends up in cache keys.
   */
  const available = await getSwitchableCurrencies();
  const resolved = resolveCurrency(
    locale,
    currency,
    available.map((entry) => entry.code),
  );

  /*
   * **Consent decides how long the choice survives, not whether it works.**
   *
   * Catalyst returns early without writing anything when `functionality` consent
   * is missing, because the cart mutation below carries the currency server-side
   * — the switch still takes effect, the cookie is only the memory of it. But a
   * shopper with no cart has nothing to carry it, so copying that shape here
   * would give them a switcher that visibly does nothing: no cookie, `refresh()`,
   * same prices back. A dead control is a worse answer to a privacy question than
   * an honest one.
   *
   * So: always honour the click, and let consent choose the lifetime. Without it
   * the cookie is a **session** cookie — set as the direct result of an explicit
   * request, gone when the browser closes, which is the ordinary carve-out for
   * cookies strictly necessary to deliver what the shopper just asked for. With
   * consent it becomes a year-long preference, which is the part that is actually
   * tracking a person across visits and therefore actually needs asking.
   */
  const store = await cookies();

  store.set(CURRENCY_COOKIE, resolved, {
    path: '/',
    sameSite: 'lax',
    // Nothing on the client reads this — the switcher's current value is
    // server-rendered, so it always agrees with the currency the page was priced
    // in. Keeping it httpOnly removes it from anything running in the page.
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    ...((await hasFunctionalityConsent()) && { maxAge: 60 * 60 * 24 * 365 }),
  });

  /*
   * **The cart has its own currency and must be re-priced too.**
   *
   * Everything above changes what the shopper is *shown*; a BigCommerce cart is
   * denominated when it is created and ignores all of it. So switching to EUR
   * repriced every product on the page and left the order summary in dollars —
   * the exact symptom this fixes.
   *
   * Failure is deliberately not surfaced. `updateCartCurrency` returns `null`
   * when BigCommerce refuses (a gift certificate is denominated at purchase, for
   * one), and the display switch has already succeeded; turning that into an
   * error would undo a change the shopper can see has happened.
   */
  const cartId = await getCartId();

  if (cartId) {
    const newCartId = await updateCartCurrency(cartId, resolved);

    if (newCartId) {
      /*
       * **The re-priced cart is a different cart.** Measured: the mutation
       * returns a new entity id rather than editing in place. Without writing it
       * back, the cookie still points at the old USD cart and the summary never
       * changes — the mutation succeeds and the shopper sees nothing, which is
       * the bug this whole path exists to fix.
       */
      if (newCartId !== cartId) {
        await setCartId(newCartId);
      }

      /*
       * Both ids. The new one so the summary reads fresh data; the old one
       * because its entry is now orphaned and would otherwise keep serving a
       * cart nobody can reach until it expires.
       */
      revalidateCart(newCartId);

      if (newCartId !== cartId) {
        revalidateCart(cartId);
      }

      return;
    }
  }

  refresh();
}
