import type { Metadata } from 'next';

import { t } from '~/lib/i18n/messages';
import { Link } from '~/ui/primitives/link';

import { RegisterForm } from './_components/register-form';

export const metadata: Metadata = {
  title: t('Auth.register'),
  robots: { index: false, follow: true },
};

export default function RegisterPage() {
  return (
    <div className="page-container py-12">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Auth.register')}</h1>
        <RegisterForm />
        <p className="mt-6 text-sm text-muted">
          {t('Auth.haveAccount')}{' '}
          <Link className="text-primary underline underline-offset-4" href="/login">
            {t('Auth.signIn')}
          </Link>
        </p>
      </div>
    </div>
  );
}
