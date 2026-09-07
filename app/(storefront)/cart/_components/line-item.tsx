import type { CartGiftCertificateLine, CartLine, CartLineOption } from '~/domain/cart';
import { formatCurrency, formatDateOnly, t } from '~/lib/i18n/messages';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';

import { LineItemControls } from './line-item-controls';

/**
 * One cart line.
 *
 * Physical and digital items share this rendering — the difference between them
 * is that a digital item has no stock position, which falls out of the data
 * rather than needing a branch. Gift certificates are genuinely different and get
 * their own component below.
 */
export function LineItemRow({ line }: { line: CartLine }) {
  return (
    <li className="flex gap-4 py-6">
      <div className="size-24 shrink-0 overflow-hidden rounded-(--radius-control) bg-accent">
        {line.image ? (
          <Image
            alt={line.image.alt}
            className="size-full object-cover"
            height={96}
            sizes="96px"
            src={line.image.src}
            width={96}
          />
        ) : (
          <span className="sr-only">{t('Common.noImage')}</span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          {line.brand && (
            <p className="text-2xs tracking-wide text-muted uppercase">{line.brand}</p>
          )}
          <Link className="font-medium hover:underline" href={line.href}>
            {line.name}
          </Link>
          {line.sku && <p className="text-sm text-muted">{line.sku}</p>}
        </div>

        {line.options.length > 0 && (
          <dl className="flex flex-col gap-0.5 text-sm text-muted">
            {line.options.map((option) => (
              <div className="flex gap-1" key={option.id}>
                <dt>{option.label}:</dt>
                <dd className="font-medium text-foreground">{optionValue(option)}</dd>
              </div>
            ))}
          </dl>
        )}

        {line.stock && <StockNotice stock={line.stock} />}

        {/*
          An immutable line was added by a promotion — a free gift, a bundled
          item. BigCommerce silently ignores updates to it, so showing the
          controls would offer an action that does nothing.
        */}
        {line.isMutable ? (
          <LineItemControls lineItemId={line.id} name={line.name} quantity={line.quantity} />
        ) : (
          <p className="text-sm text-muted">{t('Cart.itemCount', { count: line.quantity })}</p>
        )}
      </div>

      <div className="shrink-0 text-right">
        <p className="font-medium">
          {formatCurrency(line.lineTotal.value, line.lineTotal.currencyCode)}
        </p>
        {line.unitListPrice && (
          <s className="text-sm text-muted">
            {formatCurrency(line.unitListPrice.value * line.quantity, line.unitListPrice.currencyCode)}
          </s>
        )}
        {line.quantity > 1 && (
          <p className="mt-0.5 text-xs text-muted">
            {formatCurrency(line.unitPrice.value, line.unitPrice.currencyCode)}
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Renders the three option kinds. The date case is why `CartLineOption` is a
 * union rather than pre-stringified: formatting is locale-bound, so it happens
 * here rather than inside the cached read.
 *
 * `formatDateOnly`, not `formatDate` — a picked calendar date is anchored at UTC
 * midnight on submission and must be read back in UTC, or every viewer west of
 * UTC sees the previous day.
 */
function optionValue(option: CartLineOption): string {
  switch (option.kind) {
    case 'date':
      return formatDateOnly(option.iso);
    case 'number':
      return String(option.value);
    default:
      return option.value;
  }
}

/**
 * Partial availability, which is the case worth surfacing: a shopper ordering 5
 * of something with 2 on hand should learn *here* that 3 are backordered, not
 * after paying.
 */
function StockNotice({ stock }: { stock: NonNullable<CartLine['stock']> }) {
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      {stock.readyToShip > 0 && (
        <p className="text-in-stock">{t('Cart.readyToShip', { count: stock.readyToShip })}</p>
      )}
      {stock.backordered > 0 && (
        <p className="text-muted">{t('Cart.backordered', { count: stock.backordered })}</p>
      )}
      {stock.outOfStock > 0 && (
        <p className="text-out-of-stock">
          {t('Cart.outOfStockItems', { count: stock.outOfStock })}
        </p>
      )}
      {stock.backorderMessage && <p className="text-muted">{stock.backorderMessage}</p>}
    </div>
  );
}

export function GiftCertificateRow({ line }: { line: CartGiftCertificateLine }) {
  return (
    <li className="flex gap-4 py-6">
      <div className="flex size-24 shrink-0 items-center justify-center rounded-(--radius-control) bg-accent text-2xl">
        🎁
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="font-medium">{line.name}</p>
        <p className="text-sm text-muted">
          {t('Cart.giftCertificateFor', {
            name: line.recipient.name,
            email: line.recipient.email,
          })}
        </p>
        <p className="text-sm text-muted">{t('Cart.giftCertificateFrom', { name: line.sender.name })}</p>
        {line.message && <p className="text-sm text-muted italic">{line.message}</p>}

        <LineItemControls lineItemId={line.id} name={line.name} quantity={1} removeOnly />
      </div>

      <div className="shrink-0 text-right font-medium">
        {formatCurrency(line.amount.value, line.amount.currencyCode)}
      </div>
    </li>
  );
}
