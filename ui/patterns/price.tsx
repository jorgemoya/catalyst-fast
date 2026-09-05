import type { Money, Price, TaxDisplay } from '~/domain/price';
import { formatCurrency } from '~/lib/i18n/messages';
import { cn } from '~/lib/cn';

/**
 * Renders a `Price` domain value.
 *
 * Formatting lives here, not in `domain/price.ts`, because `Intl` formatting is
 * locale-dependent and the domain model is cached — caching formatted strings
 * would fork every entry per locale. See the note in domain/price.ts.
 */

/** Picks which tax variant(s) to show. BOTH renders two lines. */
function amounts(money: Money, mode: TaxDisplay): string[] {
  const inc = formatCurrency(money.inc, money.currencyCode);
  const ex = formatCurrency(money.ex, money.currencyCode);

  switch (mode) {
    case 'INC':
      return [inc];

    case 'BOTH':
      // `toPrice` has already degraded BOTH to EX when the two are equal, so
      // reaching here means they genuinely differ.
      return [`${inc} (inc. tax)`, `${ex} (ex. tax)`];

    case 'EX':
    default:
      return [ex];
  }
}

function MoneyText({ money, mode, className }: { money: Money; mode: TaxDisplay; className?: string }) {
  const lines = amounts(money, mode);

  return (
    <>
      {lines.map((line, index) => (
        <span className={cn(index > 0 && 'block text-xs text-muted', className)} key={line}>
          {line}
        </span>
      ))}
    </>
  );
}

export function PriceLabel({ price, className }: { price?: Price; className?: string }) {
  if (!price) {
    return null;
  }

  switch (price.type) {
    case 'range':
      return (
        <span className={cn('text-sm font-medium', className)}>
          <MoneyText money={price.min} mode={price.mode} />
          <span aria-hidden="true"> – </span>
          <MoneyText money={price.max} mode={price.mode} />
        </span>
      );

    case 'sale':
      return (
        <span className={cn('flex flex-wrap items-baseline gap-2 text-sm font-medium', className)}>
          <span className="text-price-sale">
            <MoneyText money={price.current} mode={price.mode} />
          </span>
          <s className="text-muted font-normal">
            <MoneyText money={price.previous} mode={price.mode} />
          </s>
        </span>
      );

    case 'plain':
    default:
      return (
        <span className={cn('text-sm font-medium', className)}>
          <MoneyText money={price.money} mode={price.mode} />
        </span>
      );
  }
}
