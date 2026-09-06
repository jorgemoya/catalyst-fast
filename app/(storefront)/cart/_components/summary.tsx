import type { CartSummary } from '~/domain/cart';
import { formatCurrency, t } from '~/lib/i18n/messages';
import { Link } from '~/ui/primitives/link';

import {
  applyCouponAction,
  applyGiftCertificateAction,
  removeCouponAction,
  removeGiftCertificateAction,
} from '../_actions/discounts';

import { CodeForm, RemoveCodeForm } from './code-form';

/**
 * Order summary.
 *
 * Shipping is deliberately absent: it isn't known until an address is, and this
 * storefront hands off to BigCommerce's hosted checkout to collect one. Showing a
 * "Total" that later grows by a shipping charge would be worse than showing the
 * subtotal and saying so. (The shipping estimator is deferred — see
 * docs/phase-4-cart.md.)
 */
export function OrderSummary({ summary }: { summary: CartSummary }) {
  const money = (value: { value: number; currencyCode: string }) =>
    formatCurrency(value.value, value.currencyCode);

  return (
    <aside className="rounded-(--radius-control) border border-border p-6">
      <h2 className="text-lg font-semibold">{t('Cart.orderSummary')}</h2>

      <dl className="mt-4 flex flex-col gap-2 text-sm">
        {summary.subtotal && (
          <Row label={t('Cart.subtotal')} value={money(summary.subtotal)} />
        )}

        {summary.discount && (
          <Row
            label={t('Cart.discount')}
            value={`−${money(summary.discount)}`}
            valueClassName="text-price-sale"
          />
        )}

        {summary.coupons.map((coupon) => (
          <Row
            key={coupon.code}
            label={
              <span className="flex items-center gap-2">
                {coupon.code}
                <RemoveCodeForm
                  action={removeCouponAction}
                  code={coupon.code}
                  label={t('Cart.removeCoupon', { code: coupon.code })}
                />
              </span>
            }
            value={`−${money(coupon.discount)}`}
            valueClassName="text-price-sale"
          />
        ))}

        {summary.giftCertificates.map((certificate) => (
          <Row
            key={certificate.code}
            label={
              <span className="flex items-center gap-2">
                {certificate.code}
                <RemoveCodeForm
                  action={removeGiftCertificateAction}
                  code={certificate.code}
                  label={t('Cart.removeGiftCertificate', { code: certificate.code })}
                />
              </span>
            }
            value={`−${money(certificate.used)}`}
            valueClassName="text-price-sale"
          />
        ))}

        {summary.tax && <Row label={t('Cart.tax')} value={money(summary.tax)} />}

        {summary.grandTotal && (
          <div className="mt-2 flex justify-between border-t border-border pt-3 text-base font-semibold">
            <dt>{t('Cart.total')}</dt>
            <dd>{money(summary.grandTotal)}</dd>
          </div>
        )}
      </dl>

      {summary.isTaxIncluded && <p className="mt-1 text-xs text-muted">{t('Cart.taxIncluded')}</p>}

      {/*
        A link, not a form: `/checkout` is a route handler that mints a
        single-use redirect URL, which BigCommerce requires be generated
        just-in-time (within 30s of use).
      */}
      <Link
        className="mt-6 flex h-12 items-center justify-center rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        data-testid="checkout"
        href="/checkout"
        prefetch={false}
      >
        {t('Cart.checkout')}
      </Link>

      <div className="mt-6 flex flex-col gap-4 border-t border-border pt-6">
        <CodeForm
          action={applyCouponAction}
          label={t('Cart.coupon')}
          name="coupon"
          placeholder={t('Cart.couponPlaceholder')}
          submitLabel={t('Cart.applyCoupon')}
        />
        <CodeForm
          action={applyGiftCertificateAction}
          label={t('Cart.giftCertificate')}
          name="gift-certificate"
          placeholder={t('Cart.giftCertificatePlaceholder')}
          submitLabel={t('Cart.applyGiftCertificate')}
        />
      </div>
    </aside>
  );
}

function Row({
  label,
  value,
  valueClassName,
}: {
  label: React.ReactNode;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className={valueClassName}>{value}</dd>
    </div>
  );
}
