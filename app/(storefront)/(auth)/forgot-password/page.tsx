import type { Metadata } from 'next';

import { t } from '~/lib/i18n/messages';

import { ForgotPasswordForm } from './_components/forgot-form';

export const metadata: Metadata = {
  title: t('Auth.forgotTitle'),
  robots: { index: false, follow: true },
};

export default function ForgotPasswordPage() {
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
