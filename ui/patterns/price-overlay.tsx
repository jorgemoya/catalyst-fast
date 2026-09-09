import { getFormatCurrency } from '~/lib/i18n/server';
import { getPersonalizedPrice } from '~/data/customer/pricing';
import { type OptionValueId, getProductPrice } from '~/data/pricing';
import { getStoreSettings } from '~/data/settings';
import type { Price } from '~/domain/price';
import { getDefaultCurrency, getSelectedCurrency } from '~/lib/currency';

/**
 * The price overlay: one slot, two reasons a shopper's price can differ from the
 * prerendered one.
 *
 *   1. they are in a customer group with its own price list
 *   2. they have switched display currency
 *
 * **It renders nothing in the common case, and that is the entire design.** The
 * shell already carries the catalog price in the channel's default currency. A
 * guest on USD — nearly all traffic — gets `null` here and a fully static page
 * with zero origin requests. Only a shopper who is *actually* different pays for
 * being different.
 *
 * Merged into one component rather than two stacked overlays because they
 * compose badly: a non-default-group customer who also switched to EUR needs
 * **one** answer, not a group price in USD with a currency price rendered over
 * it. Deciding here means the precedence is explicit and visible.
 */

const isDefaultish = (value: string, fallback: string) => value === fallback;

export async function PriceOverlay({
  productId,
  optionValueIds,
}: {
  productId: number;
  optionValueIds?: readonly OptionValueId[];
}) {
  const [settings, selected, fallback] = await Promise.all([
    getStoreSettings(),
    getSelectedCurrency(),
    getDefaultCurrency(),
  ]);

  /*
   * Group pricing wins when it applies.
   *
   * BigCommerce resolves a customer's price list against their identity, and
   * that already accounts for the currency it returns — so asking for a
   * group price and then converting it ourselves would double-apply the rules.
   * A store that needs group pricing *and* currency switching together is
   * relying on BigCommerce doing both in one response, which it does.
   */
  const personalized = await getPersonalizedPrice(
    productId,
    settings.taxDisplay.pdp,
    optionValueIds,
  );

  if (personalized) {
    return <PriceLine price={personalized} testId="personalized-price" />;
  }

  // Nothing to say: the shell is already showing this exact price.
  if (isDefaultish(selected, fallback)) {
    return null;
  }

  /*
   * A *public* cached read, keyed by currency — so every shopper viewing this
   * product in EUR shares one entry. The cookie was read above, outside the
   * cached function; the currency only ever enters as an argument.
   */
  const converted = await getProductPrice(productId, selected, optionValueIds);

  if (!converted) {
    return null;
  }

  return <PriceLine price={converted} testId="currency-price" />;
}

async function PriceLine({ price, testId }: { price: Price; testId: string }) {
  const formatCurrency = await getFormatCurrency();

  const money = (value: { inc: number; ex: number; currencyCode: string }) =>
    formatCurrency(price.mode === 'INC' ? value.inc : value.ex, value.currencyCode);

  return (
    <p className="text-2xl font-semibold" data-price-overlay data-testid={testId}>
      {price.type === 'range' && `${money(price.min)} – ${money(price.max)}`}
      {price.type === 'sale' && (
        <>
          <span className="text-price-sale">{money(price.current)}</span>{' '}
          <s className="text-base font-normal text-muted">{money(price.previous)}</s>
        </>
      )}
      {price.type === 'plain' && money(price.money)}
    </p>
  );
}
