import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { getGiftCertificateSettings } from '~/data/gift-certificates';
import { t } from '~/lib/i18n/messages';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * Gift certificate hub.
 *
 * All three gift-certificate routes redirect to `/` when the merchant has the
 * feature switched off, rather than 404ing. The URL is not wrong — the feature
 * is simply not enabled — and a 404 would suggest the storefront is broken.
 */
export const metadata: Metadata = { title: t('GiftCertificates.title') };

export default function GiftCertificatesPage() {
  return (
    <div className="page-container py-8">
      <Suspense fallback={<Skeleton className="h-40 w-full max-w-xl" />}>
        <Hub />
      </Suspense>
    </div>
  );
}

async function Hub() {
  const settings = await getGiftCertificateSettings();

  if (!settings.enabled) {
    redirect('/');
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">{t('GiftCertificates.title')}</h1>
      <p className="mt-3 text-muted">{t('GiftCertificates.intro')}</p>

      <div className="mt-6 flex flex-wrap gap-3">
        <Link
          className="rounded-(--radius-control) bg-foreground px-4 py-2 text-sm text-background"
          href="/gift-certificates/purchase/"
        >
          {t('GiftCertificates.buy')}
        </Link>
        <Link
          className="rounded-(--radius-control) border border-border px-4 py-2 text-sm hover:bg-accent"
          href="/gift-certificates/balance/"
        >
          {t('GiftCertificates.checkBalance')}
        </Link>
      </div>
    </div>
  );
}
