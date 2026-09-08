import { getStoreSettings } from '~/data/settings';
import { getPersonalizedPrice } from '~/data/customer/pricing';
import type { OptionValueId } from '~/data/pricing';
import { formatCurrency } from '~/lib/i18n/messages';

/**
 * Personalized price overlay.
 *
 * Renders **nothing** unless the shopper is in a non-default customer group, and
 * that emptiness is the point: for guests and for default-group customers — most
 * signed-in traffic on most stores — the cached shell price stands untouched and
 * this costs zero origin requests.
 *
 * The price it replaces is already on screen, prerendered, by the time this
 * resolves. So the trade-off is a brief flash of catalog pricing for the minority
 * who see group pricing, in exchange for every other visitor getting a fully
 * static page. Plan §3.2 records the alternatives if a store needs the other
 * trade: `PRICING_MODE=dynamic`, or per-group impersonation tokens.
 */
export async function PersonalizedPrice({
  productId,
  optionValueIds,
}: {
  productId: number;
  optionValueIds?: readonly OptionValueId[];
}) {
  const settings = await getStoreSettings();
  const price = await getPersonalizedPrice(productId, settings.taxDisplay.pdp, optionValueIds);

  if (!price) {
    return null;
  }

  const money = (value: { inc: number; ex: number; currencyCode: string }) =>
    formatCurrency(price.mode === 'INC' ? value.inc : value.ex, value.currencyCode);

  return (
    <p className="text-2xl font-semibold" data-testid="personalized-price">
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
