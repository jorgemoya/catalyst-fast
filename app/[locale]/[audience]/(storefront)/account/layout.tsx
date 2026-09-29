import { getT } from '~/lib/i18n/server';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { getSession } from '~/data/customer/session';
import { Link } from '~/ui/primitives/link';

/**
 * Account chrome.
 *
 * The guard lives here rather than in each page: one place to get right, and a
 * page added later inherits it instead of forgetting it.
 *
 * `redirect` rather than `notFound`, carrying `redirectTo` so signing in returns
 * the shopper where they were going. `safeRedirectPath` validates it on the way
 * back — a redirect target is attacker-controlled even when we generated it,
 * because the shopper can edit the URL.
 *
 * This makes every `/account/*` route dynamic, which is correct: there is no
 * shareable shell for a page that is entirely one customer's data.
 */
/**
 * The account section is **deliberately not prerendered**.
 *
 * `instant = false` is normally a temporary escape hatch (plan Part 8), but it is
 * the correct resting state here, for a reason specific to this segment: the
 * layout must know whether the shopper is signed in *before* it can decide to
 * redirect, and a redirect cannot be streamed — once a shell has flushed, the
 * status is already sent. There is also nothing worth prerendering, since every
 * page below is one customer's data end to end.
 *
 * Worth recording how this surfaced: the build only started failing once
 * `AUTH_SECRET` was configured. Until then `getSession()` short-circuited to null
 * without touching `cookies()`, so these routes *looked* prerenderable and the
 * build was green. Enabling auth is what revealed they never were.
 */
export const instant = false;

const SECTIONS = [
  { href: '/account/orders', label: 'Auth.orders' },
  { href: '/account/addresses', label: 'Auth.addresses' },
  { href: '/account/wishlists', label: 'Auth.wishlists' },
  { href: '/account/settings', label: 'Auth.settings' },
] as const;

export default async function AccountLayout({ children }: { children: ReactNode }) {
  const t = await getT();

  const session = await getSession();

  if (!session) {
    redirect(`/login?redirectTo=${encodeURIComponent('/account/orders')}`);
  }

  return (
    <div className="page-container py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('Auth.myAccount')}</h1>

      {session.impersonatorId !== null && (
        <p className="mt-4 rounded-(--radius-control) border border-border bg-accent p-3 text-sm">
          {t('Auth.impersonating')}
        </p>
      )}

      <div className="mt-8 flex flex-col gap-8 lg:flex-row">
        <nav aria-label={t('Auth.myAccount')} className="w-full shrink-0 lg:w-56">
          <ul className="sticky top-24 flex flex-col gap-1">
            {SECTIONS.map((section) => (
              <li key={section.href}>
                <Link
                  className="block rounded-(--radius-control) px-3 py-2 text-sm hover:bg-accent"
                  href={section.href}
                >
                  {t(section.label)}
                </Link>
              </li>
            ))}
            <li className="mt-2 border-t border-border pt-2">
              <Link
                className="block rounded-(--radius-control) px-3 py-2 text-sm text-muted hover:bg-accent"
                href="/logout"
              >
                {t('Auth.signOut')}
              </Link>
            </li>
          </ul>
        </nav>

        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
