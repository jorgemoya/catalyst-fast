import { getSwitchableCurrencies } from '~/data/currencies';
import { getSelectedCurrency } from '~/lib/currency';

import { CurrencySwitcher } from './currency-switcher';

/**
 * Server half of the currency switcher.
 *
 * **This is a dynamic hole, on purpose.** It reads the currency cookie, so it
 * cannot be in the static shell — but it is a small control in the header, not
 * page content, and it sits behind its own `<Suspense>`. The important property
 * is that nothing *else* becomes dynamic: prices still render from the shell in
 * the default currency, and only this control knows what the shopper picked.
 */
export async function CurrencyGate() {
  const [currencies, selected] = await Promise.all([
    getSwitchableCurrencies(),
    getSelectedCurrency(),
  ]);

  if (currencies.length < 2) {
    return null;
  }

  return <CurrencySwitcher currencies={currencies} selected={selected} />;
}
