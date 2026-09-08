import { redirect } from 'next/navigation';
import { connection } from 'next/server';

import { env } from '~/lib/env';

/**
 * Shortcut to the BigCommerce control panel.
 *
 * A convenience for the people running the store — `/admin` is muscle memory
 * from Stencil, where BigCommerce serves it natively. A headless storefront
 * doesn't, so the link would 404 without this.
 *
 * **Env-gated, and off by default.** The store hash is not secret, but this
 * route advertises which BigCommerce store backs the site and hands a visitor a
 * one-click path to its login. That is unnecessary attack surface on a public
 * storefront, so a merchant opts in with `ENABLE_ADMIN_REDIRECT=true` rather
 * than getting it whether they want it or not.
 */
export async function GET(): Promise<Response> {
  /*
   * Forces per-request evaluation.
   *
   * Without it Next prerenders this handler at build time and freezes whatever
   * the env said *then* into a static response — measured: with the flag off at
   * build and on at runtime, the route still answered 404. A gate that reads
   * configuration has to actually run when the request arrives.
   *
   * `connection()` rather than `export const dynamic = 'force-dynamic'`, which
   * `cacheComponents` rejects outright.
   */
  await connection();

  if (env.ENABLE_ADMIN_REDIRECT !== 'true') {
    /*
     * A plain 404 response, not `redirect('/not-found')` — that answered **307**
     * and bounced the visitor to a URL that then 404'd, which is two wrong
     * status codes to say one simple thing. Disabled and non-existent should be
     * indistinguishable from outside, and that means 404 on the first response.
     */
    return new Response(null, { status: 404 });
  }

  redirect(`https://store-${env.BIGCOMMERCE_STORE_HASH}.mybigcommerce.com/manage`);
}
