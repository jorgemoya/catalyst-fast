import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getOrder } from '~/data/customer/orders';
import { formatCurrency, formatDate, t } from '~/lib/i18n/messages';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';

export const metadata: Metadata = {
  title: t('Account.orderDetail'),
  robots: { index: false, follow: false },
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function OrderDetailPage({ params }: Props) {
  const order = await getOrder(Number((await params).id));

  // Also what another customer's order id produces — BigCommerce scopes the
  // query to the access token, so this is a not-found rather than a leak.
  if (!order) {
    notFound();
  }

  const money = (value: { value: number; currencyCode: string }) =>
    formatCurrency(value.value, value.currencyCode);

  return (
    <section>
      <Link className="text-sm text-muted underline underline-offset-4" href="/account/orders">
        {t('Account.backToOrders')}
      </Link>

      <header className="mt-4">
        <h2 className="text-lg font-semibold">{t('Account.orderNumber', { id: order.id })}</h2>
        <p className="mt-1 text-sm text-muted">
          {t('Account.orderPlaced', { date: formatDate(order.orderedAt) })} · {order.status}
        </p>
      </header>

      <ul className="mt-6 divide-y divide-border border-y border-border" data-testid="order-lines">
        {order.lines.map((line) => (
          <li className="flex items-center gap-4 py-4" key={line.id}>
            <span className="size-16 shrink-0 overflow-hidden rounded-(--radius-control) bg-accent">
              {line.image && (
                <Image
                  alt={line.image.alt}
                  className="size-full object-cover"
                  height={64}
                  sizes="64px"
                  src={line.image.src}
                  width={64}
                />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{line.name}</p>
              <p className="text-sm text-muted">{t('Cart.itemCount', { count: line.quantity })}</p>
            </div>
            <p className="font-medium">{money(line.total)}</p>
          </li>
        ))}
      </ul>

      <div className="mt-6 grid gap-8 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">{t('Account.shippedTo')}</h3>
          <address className="text-sm text-muted not-italic">
            {order.billingAddress.map((line) => (
              <span className="block" key={line}>
                {line}
              </span>
            ))}
          </address>
        </div>

        <dl className="flex flex-col gap-2 text-sm">
          <Row label={t('Account.orderSubtotal')} value={money(order.subtotal)} />
          <Row label={t('Account.orderShipping')} value={money(order.shipping)} />
          <Row label={t('Account.orderTax')} value={money(order.tax)} />
          <div className="flex justify-between border-t border-border pt-2 text-base font-semibold">
            <dt>{t('Account.orderTotal')}</dt>
            <dd>{money(order.total)}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
