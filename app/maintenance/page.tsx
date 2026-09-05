import { t } from '~/lib/i18n/messages';

/**
 * Rewrite target for `withRoutes` when BigCommerce reports the storefront is in
 * MAINTENANCE status. Not linked from anywhere.
 *
 * Deliberately data-free: the store being down is exactly when a BigCommerce
 * round trip is least likely to succeed. Phase 5 can add the merchant's
 * configured status message behind a Suspense boundary, so a failed fetch
 * degrades to this static copy rather than an error page.
 */
export default function MaintenancePage() {
  return (
    <main className="page-container flex min-h-dvh flex-col justify-center gap-4 py-16" id="main">
      <h1 className="text-4xl font-semibold tracking-tight text-balance">
        {t('Maintenance.title')}
      </h1>
      <p className="max-w-prose text-muted">{t('Maintenance.subtitle')}</p>
    </main>
  );
}
