import type { Metadata } from 'next';
import { Suspense } from 'react';

import { t } from '~/lib/i18n/messages';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

import { LoginForm } from './_components/login-form';

/**
 * Sign in.
 *
 * `noindex`: a login page has nothing to index and, with `?redirectTo=`, an
 * unbounded URL space.
 *
 * The form is a client island reading `redirectTo` from `useSearchParams`, so the
 * heading and the create-account panel beside it stay in the prerendered shell.
 * Reading the param on the server would make the whole route dynamic to carry a
 * value the browser already has.
 */

export const metadata: Metadata = {
  title: t('Auth.signIn'),
  robots: { index: false, follow: true },
};

export default function LoginPage() {
  return (
    <div className="page-container py-12">
      <div className="mx-auto grid max-w-4xl gap-12 md:grid-cols-2">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">{t('Auth.signIn')}</h1>

          <Suspense fallback={<FormSkeleton />}>
            <LoginForm />
          </Suspense>
        </section>

        <section className="rounded-(--radius-card) border border-border p-6">
          <h2 className="text-lg font-semibold">{t('Auth.newCustomerTitle')}</h2>
          <p className="mt-2 text-sm text-muted">{t('Auth.newCustomerSubtitle')}</p>
          <ul className="mt-4 flex flex-col gap-2 text-sm text-muted">
            <li>{t('Auth.benefitFasterCheckout')}</li>
            <li>{t('Auth.benefitOrderHistory')}</li>
            <li>{t('Auth.benefitWishlists')}</li>
          </ul>
          <Link
            className="mt-6 inline-flex h-11 items-center rounded-(--radius-control) border border-border px-6 text-sm font-medium transition-colors hover:bg-accent"
            href="/register"
          >
            {t('Auth.createAccount')}
          </Link>
        </section>
      </div>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="mt-6 flex flex-col gap-4">
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-11 w-32" />
    </div>
  );
}
