import type { Metadata } from 'next';

import { t } from '~/lib/i18n/messages';

import { logout } from '../_actions/logout';

/**
 * Sign out.
 *
 * A form POST rather than a link, because signing out is a state change: a GET
 * would let any page — or a prefetch — log the shopper out by linking to it.
 * next-auth's CSRF check applies to the POST.
 */
export const metadata: Metadata = {
  title: t('Auth.signOut'),
  robots: { index: false, follow: false },
};

export default function LogoutPage() {
  return (
    <div className="page-container flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t('Auth.signOutConfirm')}</h1>
      <form action={logout}>
        <button
          className="h-11 rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          type="submit"
        >
          {t('Auth.signOut')}
        </button>
      </form>
    </div>
  );
}
