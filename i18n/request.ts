import { getRequestConfig } from 'next-intl/server';
import { locale } from 'next/root-params';

import { messagesFor, normalizeLocale } from '~/lib/i18n/messages';

/**
 * next-intl request configuration.
 *
 * **It never reads `params.requestLocale`, and that is the whole trick.** In
 * `getConfig.js` that parameter is a *getter* which calls `headers()` on access:
 *
 *     get requestLocale() {
 *       return localeOverride ? Promise.resolve(localeOverride) : getRequestLocale();
 *     }
 *
 * Touch it and this becomes request-scoped, which would drag every page out of
 * the static shell. Reading the `locale` **root param** instead keeps it part of
 * the route, so `getTranslations()` is legal inside a `use cache` body and each
 * locale prerenders its own shell.
 *
 * Verified before adopting: a `use cache` function calling `getTranslations()`
 * prerendered as ◐ for both `/en` and `/es` and returned the right language.
 *
 * next-intl 4 deprecates `requestLocale` and `setRequestLocale` in favour of
 * exactly this, so it is the supported path rather than a workaround.
 *
 * `timeZone` is pinned because an unset zone differs between the prerendering
 * server and the browser, which is a hydration-mismatch source. Nothing in
 * either catalogue formats a date — dates go through `lib/i18n/messages.ts` —
 * so this only fixes the assumed zone if a future message uses ICU date
 * formatting.
 */
export default getRequestConfig(async ({ locale: override }) => {
  /*
   * The override comes first, and it is load-bearing.
   *
   * `getTranslations({ locale })` passes its argument here as `params.locale`.
   * Server Actions and Route Handlers use that form because
   * `next/root-params` is unavailable to them — calling `locale()` there throws
   * "`import('next/root-params').locale()` was used inside a Server Action".
   * Ignoring the override and reading the root param unconditionally broke every
   * sign-in path, caught by the auth e2e suite.
   *
   * Reading `params.locale` is safe. It is `params.requestLocale` that must be
   * avoided — that one is a getter which calls `headers()`.
   */
  const active = normalizeLocale(override ?? (await locale()));

  /*
   * `messagesFor` merges the translated catalogue over English, so a key nobody
   * has translated yet renders English rather than its own path. That has to
   * happen in the *data*, not via `getMessageFallback`: the callback cannot cross
   * into `NextIntlClientProvider`, so it would fix Server Components and silently
   * skip Client ones. See `lib/i18n/messages.ts`.
   */
  return { locale: active, messages: messagesFor(active), timeZone: 'UTC' };
});
