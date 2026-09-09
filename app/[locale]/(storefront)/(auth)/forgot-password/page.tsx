import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';


import { ForgotPasswordForm } from './_components/forgot-form';

/** Translated, so it must be generated per request rather than at import. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return {
  title: t('Auth.forgotTitle'),
  robots: { index: false, follow: true },
  };
}

export default async function ForgotPasswordPage() {
  const t = await getT();

  return (
    <div className="page-container py-12">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Auth.forgotTitle')}</h1>
        <p className="mt-2 text-sm text-muted">{t('Auth.forgotSubtitle')}</p>
        <ForgotPasswordForm />
      </div>
    </div>
  );
}
