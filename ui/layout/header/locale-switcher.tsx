'use client';

import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { useTranslations } from 'next-intl';

/**
 * Language picker.
 *
 * **Navigates rather than setting a cookie**, which is the whole point of locale
 * being a route segment: `/es/garden/` is a real, shareable, crawlable URL, and
 * a shopper who sends it to someone gets Spanish. A cookie-based switch would
 * serve two different languages from one URL — bad for crawlers, and impossible
 * to link to.
 *
 * The default locale's prefix is stripped, so English keeps the clean URLs the
 * store already has and only Spanish carries `/es`. `proxies/locale.ts` owns the
 * matching rule on the way in.
 */
export function LocaleSwitcher({
  locales,
  current,
  defaultLocale,
}: {
  locales: string[];
  current: string;
  defaultLocale: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (locales.length < 2) {
    return null;
  }

  /**
   * Rebuilds the current path under another locale.
   *
   * Reads `window.location.pathname` **in the event handler**, not
   * `usePathname()` during render. Under `cacheComponents`, reading URL data
   * while rendering forces the component into a `<Suspense>` boundary — the
   * build fails with "encountered URL data `usePathname()` in a Client Component
   * outside of `<Suspense>`" — which would turn this control into a dynamic hole
   * on every page. At click time the URL is simply there, and the switcher stays
   * in the static shell.
   *
   * The existing prefix is stripped before the new one is applied; without that,
   * switching twice yields `/es/es/garden/`.
   */
  const hrefFor = (target: string): string => {
    const withoutLocale = locales.reduce(
      (path, locale) =>
        path === `/${locale}` ? '/' : path.replace(new RegExp(`^/${locale}/`), '/'),
      window.location.pathname,
    );

    return target === defaultLocale
      ? withoutLocale
      : `/${target}${withoutLocale === '/' ? '' : withoutLocale}`;
  };

  return (
    <label className="flex items-center">
      <span className="sr-only">{t('Header.language')}</span>
      <select
        aria-label={t('Header.language')}
        className="rounded-(--radius-control) border border-border bg-background px-2 py-1 text-sm uppercase disabled:opacity-60"
        disabled={pending}
        onChange={(event) => {
          const href = hrefFor(event.target.value);

          startTransition(() => {
            router.push(href);
          });
        }}
        value={current}
      >
        {locales.map((locale) => (
          <option key={locale} value={locale}>
            {locale}
          </option>
        ))}
      </select>
    </label>
  );
}
