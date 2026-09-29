import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { getGiftCertificateSettings } from '~/data/gift-certificates';
import { GiftCertificateBalanceForm } from '~/ui/patterns/gift-certificate-balance-form';
import { Skeleton } from '~/ui/primitives/skeleton';

/** Translated, so it must be generated per request rather than at import. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return {
  title: t('GiftCertificates.balanceTitle'),
  // A balance lookup is a private query about a bearer instrument; there is
  // nothing here worth indexing.
  robots: { index: false, follow: true },
  };
}

export default async function GiftCertificateBalancePage() {
  const t = await getT();

  return (
    <div className="page-container py-8">
      <h1 className="mb-6 text-2xl font-semibold">{t('GiftCertificates.balanceTitle')}</h1>
      <Suspense fallback={<Skeleton className="h-40 w-full max-w-md" />}>
        <BalanceLookup />
      </Suspense>
    </div>
  );
}

async function BalanceLookup() {
  const settings = await getGiftCertificateSettings();

  if (!settings.enabled) {
    redirect('/');
  }

  return <GiftCertificateBalanceForm />;
}
