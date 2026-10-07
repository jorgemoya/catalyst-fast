import { DEFAULT_LOCALE, isLocale } from '~/lib/config/channels';

/**
 * Adds the active locale to an internal href.
 *
 * **The gap this closes.** Locale is a URL segment, and the proxy strips the
 * default locale's prefix so English keeps clean URLs. That works perfectly for
 * requests coming *in* — and did nothing for links going *out*. A Spanish
 * shopper on `/es/zz-plant/` saw a header logo pointing at `/`, category links
 * pointing at `/garden/`, a cart at `/cart/`: measured, 29 of 29 internal links
 * on the Spanish home page were unprefixed. Every one of them silently dropped
 * the shopper back into English on the next click.
 *
 * Catalog paths make this unavoidable rather than a slip. `product.path` comes
 * from BigCommerce as `/zz-plant/` and knows nothing about locale, so prefixing
 * cannot live at the data layer — it has to happen where the href is rendered.
 * That is why this is applied centrally in `ui/primitives/link.tsx` rather than
 * at 32 call sites, which is also the version that stays correct when someone
 * adds the 33rd.
 *
 * Everything here is a pure string transform so it can be unit-tested and run
 * identically on the server and in the browser.
 */

/** Never prefixed: not app routes, or deliberately outside the locale tree. */
const NON_ROUTE = /^\/(?:_next|api)(?:\/|$)/u;

const SSO_LANDING = /^\/login\/token\//u;

export function localizeHref(href: string, locale: string): string {
  // The default locale is served from unprefixed URLs — adding `/en` would
  // produce a redirect on every click.
  if (locale === DEFAULT_LOCALE) {
    return href;
  }

  /*
   * Anything that is not an absolute app path is left exactly as written:
   * external URLs, protocol-relative URLs, `#anchors`, `mailto:`, and relative
   * paths. Prefixing those would corrupt them.
   */
  if (!href.startsWith('/') || href.startsWith('//')) {
    return href;
  }

  if (NON_ROUTE.test(href)) {
    return href;
  }

  /*
   * `/login/token/…` is an SSO landing URL BigCommerce builds itself; it is
   * never localized, so a link to one is left as written.
   *
   * `/checkout/` **is** prefixed, although its route handler lives outside
   * `[locale]`: the proxy strips `/es` before matching it (`LOCALE_EXEMPT_PATH`)
   * and forwards the locale as a header. That header is how checkout knows the
   * shopper's channel — and so which channel's cart to hand to BigCommerce.
   * Unprefixed, every locale checked out the default channel's cart.
   */
  if (SSO_LANDING.test(href)) {
    return href;
  }

  // Already localized. Guards against double-prefixing when a caller has
  // resolved the locale itself, which would give `/es/es/garden/`.
  const [, first] = href.split('/');

  if (first && isLocale(first)) {
    return href;
  }

  return `/${locale}${href === '/' ? '/' : href}`;
}
