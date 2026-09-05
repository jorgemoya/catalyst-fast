'use client';

import { useEffect } from 'react';

import { t } from '~/lib/i18n/messages';

/**
 * Storefront error boundary.
 *
 * Scoped to the `(storefront)` group so the header and footer survive an error
 * in the page body — a shopper who hits a failing PDP keeps their navigation and
 * can carry on, rather than landing on a bare error screen.
 *
 * Error boundaries must be Client Components: React needs `reset()` to re-run
 * the failed render on the client.
 */
export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Production builds strip the message and expose only a `digest`, which is
    // what correlates a user report with the server log.
    console.error('[storefront]', error.digest ?? error.message);
  }, [error]);

  return (
    <div className="page-container flex flex-col items-start gap-4 py-24">
      <h1 className="text-2xl font-semibold tracking-tight">{t('Error.title')}</h1>
      <p className="max-w-prose text-sm text-muted">{t('Error.subtitle')}</p>
      <button
        className="h-10 rounded-(--radius-control) bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        onClick={reset}
        type="button"
      >
        {t('Error.retry')}
      </button>
    </div>
  );
}
