import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';

import { Link } from '~/ui/primitives/link';

import { RegisterForm } from './_components/register-form';

/** Translated, so it must be generated per request rather than at import. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return {
  title: t('Auth.register'),
  robots: { index: false, follow: true },
  };
}

export default async function RegisterPage() {
  const t = await getT();

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
