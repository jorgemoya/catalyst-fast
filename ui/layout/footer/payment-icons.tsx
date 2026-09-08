import { t } from '~/lib/i18n/messages';

/**
 * Payment-method marks in the footer.
 *
 * **Static, and deliberately so.** BigCommerce's Storefront API does not expose
 * which payment methods a store has enabled — that lives behind the Management
 * API — so a storefront cannot render an accurate list without a credential it
 * should not have at render time. Catalyst hardcodes the same set.
 *
 * The honest framing is that these are trust marks rather than a statement of
 * fact: the authoritative list is on the checkout page, which BigCommerce hosts
 * and renders from the real configuration. Edit this array to match the store.
 *
 * Inline SVG rather than images: six network marks as separate requests on every
 * page is a poor trade for decoration that sits below the fold, and inline paths
 * cost nothing extra once gzipped.
 */
const METHODS = [
  { name: 'Visa', d: 'M9.5 15.5 11 8.5h2.2l-1.5 7zM19 8.7a5.5 5.5 0 0 0-2-.35c-2.2 0-3.75 1.1-3.76 2.7 0 1.17 1.1 1.82 1.94 2.21.86.4 1.15.66 1.14 1.02 0 .55-.68.8-1.31.8-.88 0-1.34-.12-2.06-.42l-.28-.13-.3 1.8c.5.22 1.44.41 2.42.42 2.34 0 3.86-1.09 3.88-2.79 0-.93-.58-1.64-1.85-2.22-.77-.38-1.24-.63-1.24-1.01 0-.34.4-.7 1.27-.7a4 4 0 0 1 1.66.32l.2.09zM24.5 8.5h-1.7c-.53 0-.92.15-1.15.68l-3.27 7.32h2.31l.46-1.24h2.82l.27 1.24h2.04zm-2.72 4.52.88-2.3.5 2.3zM7.7 8.5 5.5 13.3l-.24-1.18a5.4 5.4 0 0 0-2.6-2.92l2 6.3h2.33L10.05 8.5z' },
  { name: 'Mastercard', d: 'M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12m8 0a6 6 0 0 0-3.2.93 7.2 7.2 0 0 1 0 10.14A6 6 0 1 0 20 6' },
  { name: 'American Express', d: 'M3 7h26v10H3zm2.6 2-2 6h1.6l.36-1.1h2.1L8 15h1.7l-2-6zm.9 1.4.6 2h-1.2zM11 9v6h5v-1.3h-3.4v-1h3.3v-1.3h-3.3v-1H16V9zm7 0-2.2 3 2.2 3h1.9l1.3-1.9 1.3 1.9h2l-2.3-3.1L25.4 9h-1.9l-1.2 1.8L21.1 9z' },
  { name: 'PayPal', d: 'M11.5 6h5.2c2.8 0 4.6 1.4 4.2 4.2-.4 3-2.6 4.4-5.4 4.4h-1.8l-.6 3.9h-2.7zm2.3 2.2-.5 3.4h1.4c1.4 0 2.4-.6 2.6-2 .2-1-.4-1.4-1.5-1.4zM19 9.5h2.6c2.5 0 4.1 1.2 3.7 3.8-.4 2.7-2.4 4-4.9 4h-1.6l-.6 3.7h-2.5z' },
];

export function PaymentIcons() {
  return (
    <div aria-label={t('Footer.payments')} className="flex flex-wrap items-center gap-2" role="list">
      {METHODS.map((method) => (
        <span
          className="inline-flex h-6 w-10 items-center justify-center rounded border border-border bg-background"
          key={method.name}
          role="listitem"
          title={method.name}
        >
          {/* `aria-hidden` on the glyph and the name on the wrapper: without it a
              screen reader reads the path as unlabelled graphics. */}
          <svg aria-hidden="true" className="h-4 w-8" fill="currentColor" viewBox="0 0 32 24">
            <path d={method.d} />
          </svg>
          <span className="sr-only">{method.name}</span>
        </span>
      ))}
    </div>
  );
}
