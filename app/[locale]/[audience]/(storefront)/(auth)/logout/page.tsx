import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';


import { LogoutForm } from './_components/logout-form';

/**
 * Sign out.
 *
 * A form POST rather than a link, because signing out is a state change: a GET
 * would let any page — or a prefetch — log the shopper out by linking to it.
 * next-auth's CSRF check applies to the POST.
 */
/** Translated, so it must be generated per request rather than at import. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return {
  title: t('Auth.signOut'),
  robots: { index: false, follow: false },
  };
}

export default async function LogoutPage() {
  const t = await getT();

  return (
    <div className="page-container flex flex-col items-center gap-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{t('Auth.signOutConfirm')}</h1>
      <LogoutForm />
    </div>
  );
}
