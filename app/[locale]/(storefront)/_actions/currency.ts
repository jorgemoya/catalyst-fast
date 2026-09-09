'use server';

import { refresh } from 'next/cache';
import { cookies } from 'next/headers';

import { resolveCurrency } from '~/lib/config/channels';
import { getSwitchableCurrencies } from '~/data/currencies';
import { CURRENCY_COOKIE, activeLocale, hasFunctionalityConsent } from '~/lib/currency';

/**
 * Switches the display currency.
 *
 * Ends with `refresh()` and nothing else — deliberately. There is no
 * `updateTag` because **nothing was invalidated**: the USD entries are still
 * correct and still wanted by every other shopper. Switching currency changes
 * which cache key this shopper reads, not the validity of any entry. Calling
 * `updateTag(tags.prices)` here would evict the whole store's pricing because
 * one person wanted euros.
 *
 * `refresh()` is required though: the currency lives in a cookie read by
 * `'use cache: private'` scopes, and those live in the browser, so a server-side
 * invalidation could not reach them even in principle. This is the same pairing
 * documented in `lib/cart/revalidate.ts`, minus the half that does not apply.
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
   * is missing, because it also runs a cart mutation that carries the currency
   * server-side — the switch still takes effect, the cookie is just the memory of
   * it. We have no such mutation, so copying that shape here would produce a
   * switcher that visibly does nothing: no cookie, `refresh()`, same prices back.
   * A dead control is a worse answer to a privacy question than an honest one.
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

  refresh();
}
