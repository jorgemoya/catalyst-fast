import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { getGiftCertificateSettings } from '~/data/gift-certificates';
import { GiftCertificateForm } from '~/ui/patterns/gift-certificate-form';
import { Skeleton } from '~/ui/primitives/skeleton';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return { title: t('GiftCertificates.purchaseTitle') };
}

export default async function PurchaseGiftCertificatePage() {
  const t = await getT();

  return (
    <div className="page-container py-8">
      <h1 className="mb-6 text-2xl font-semibold">{t('GiftCertificates.purchaseTitle')}</h1>
      <Suspense fallback={<Skeleton className="h-96 w-full max-w-xl" />}>
        <Purchase />
      </Suspense>
    </div>
  );
}

async function Purchase() {
  const settings = await getGiftCertificateSettings();

  if (!settings.enabled) {
    redirect('/');
  }

  /*
   * The **expiry rule** is passed down, not a computed date.
   *
   * Calling `new Date()` here failed the build outright: "Next.js encountered
   * the unstable value `new Date()` while prerendering" — the same class of
   * error as `crypto.getRandomValues()` on the PDP. A prerendered page cannot
   * contain a value that depends on when it rendered, and baking a date into a
   * static shell would be wrong regardless: the shell might be minutes or weeks
   * old by the time a shopper reads it.
   *
   * Computing it in the browser is also simply more correct, since "expires 12
   * months from now" is relative to the shopper's now, not the build's.
   */
  return (
    <GiftCertificateForm
      amounts={settings.mode === 'fixed' ? settings.amounts : undefined}
      currencyCode={settings.currencyCode}
      expiry={settings.expiry}
      max={settings.mode === 'custom' ? settings.max : undefined}
      min={settings.mode === 'custom' ? settings.min : undefined}
    />
  );
}
