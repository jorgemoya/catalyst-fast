import { getFormatCurrency, getFormatDate, getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';

import { getOrders } from '~/data/customer/orders';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';

/** Translated, so it must be generated per request rather than at import. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return {
  title: t('Auth.orders'),
  robots: { index: false, follow: false },
  };
}

interface Props {
  searchParams: Promise<{ after?: string }>;
}

export default async function OrdersPage({ searchParams }: Props) {
  const t = await getT();

  const formatDate = await getFormatDate();

  const formatCurrency = await getFormatCurrency();

  const { after } = await searchParams;
  const history = await getOrders(after);

  if (!history || history.orders.length === 0) {
    return (
      <div className="rounded-(--radius-card) border border-border py-16 text-center">
        <h2 className="text-lg font-semibold">{t('Account.noOrdersTitle')}</h2>
        <p className="mt-2 text-sm text-muted">{t('Account.noOrdersSubtitle')}</p>
        <Link
          className="mt-4 inline-flex h-11 items-center rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground"
          href="/"
        >
          {t('Cart.continueShopping')}
        </Link>
      </div>
    );
  }

  return (
    <>
      <ul className="flex flex-col divide-y divide-border border-y border-border" data-testid="orders">
        {history.orders.map((order) => (
          <li className="flex items-center gap-4 py-4" key={order.id}>
            <div className="flex -space-x-3">
              {order.previewImages.map((image) => (
                <span
                  className="size-12 overflow-hidden rounded-(--radius-control) border border-border bg-accent"
                  key={image.src}
                >
                  <Image
                    alt={image.alt}
                    className="size-full object-cover"
                    height={48}
                    sizes="48px"
                    src={image.src}
                    width={48}
                  />
                </span>
              ))}
            </div>

            <div className="min-w-0 flex-1">
              <Link className="font-medium hover:underline" href={`/account/orders/${order.id}`}>
                {t('Account.orderNumber', { id: order.id })}
              </Link>
              <p className="text-sm text-muted">
                <time dateTime={order.orderedAt}>{formatDate(order.orderedAt)}</time>
                {' · '}
                {t('Cart.itemCount', { count: order.itemCount })}
              </p>
            </div>

            <div className="text-right">
              <p className="font-medium">
                {formatCurrency(order.total.value, order.total.currencyCode)}
              </p>
              <p className="text-sm text-muted">{order.status}</p>
            </div>
          </li>
        ))}
      </ul>

      {history.pagination.hasNextPage && history.pagination.endCursor && (
        <nav aria-label={t('Listing.pagination')} className="mt-8 flex justify-center">
          <Link
            className="rounded-(--radius-control) border border-border px-4 py-2 text-sm hover:bg-accent"
            href={`/account/orders?after=${encodeURIComponent(history.pagination.endCursor)}`}
          >
            {t('Listing.next')}
          </Link>
        </nav>
      )}
    </>
  );
}
