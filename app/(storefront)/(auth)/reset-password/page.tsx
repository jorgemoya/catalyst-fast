import type { Metadata } from 'next';
import { Suspense } from 'react';

import { t } from '~/lib/i18n/messages';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

import { ResetPasswordForm } from './_components/reset-form';

/**
 * Completes a password reset from the emailed link.
 *
 * BigCommerce sends `?c=<customerId>&t=<token>` to whatever `path` the request
 * mutation was given — `/reset-password`, set in `_actions/password.ts`. The two
 * must stay in step; changing one without the other silently breaks every link
 * already in shoppers' inboxes.
 */

export const metadata: Metadata = {
  title: t('Auth.resetTitle'),
  robots: { index: false, follow: false },
};

interface Props {
  searchParams: Promise<{ c?: string; t?: string }>;
}

export default function ResetPasswordPage({ searchParams }: Props) {
  return (
    <div className="page-container py-12">
      <div className="mx-auto max-w-lg">
        <h1 className="text-2xl font-semibold tracking-tight">{t('Auth.resetTitle')}</h1>
        <Suspense fallback={<Skeleton className="mt-6 h-40 w-full max-w-sm" />}>
          <ResetContent searchParams={searchParams} />
        </Suspense>
      </div>
    </div>
  );
}

async function ResetContent({ searchParams }: Props) {
  const params = await searchParams;

  // A link that lost its parameters cannot be completed. Saying so beats
  // rendering a form whose submission is guaranteed to fail.
  if (!params.c || !params.t) {
    return (
      <div className="mt-6">
        <p className="text-sm text-error">{t('Auth.invalidResetLink')}</p>
        <Link className="mt-4 inline-block text-sm text-primary underline" href="/forgot-password">
          {t('Auth.sendReset')}
        </Link>
      </div>
    );
  }

  return <ResetPasswordForm customerId={params.c} token={params.t} />;
}
