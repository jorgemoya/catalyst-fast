import { expect, test } from '@playwright/test';

import { SIMPLE_PRODUCT } from './fixtures';

/**
 * Currency switching.
 *
 * The interesting assertion is not "the price changed" — it is that **exactly
 * one price is on screen**. The prerendered price and the converted overlay both
 * exist in the DOM by design, and an earlier version showed both at once
 * ("$80.00 €77.75"), which reads as a broken store. A CSS `:has()` rule hides
 * the base price when an overlay lands, and nothing else guards it.
 */
const CURRENCY_SELECT = 'select[aria-label="Currency"]';

const visibleMoney = async (page: import('@playwright/test').Page): Promise<string[]> => {
  const text = await page.locator('main').innerText();

  return [...text.matchAll(/[$€£][\d.,]+/g)].map((match) => match[0]);
};

test.describe('currency', () => {
  test('shows one price, in the selected currency', async ({ page, context }) => {
    await page.goto(SIMPLE_PRODUCT);

    const switcher = page.locator(CURRENCY_SELECT);

    // Skips rather than fails on a single-currency store: the switcher not
    // rendering is correct there, not a regression.
    if ((await switcher.count()) === 0) {
      test.skip(true, 'store offers a single currency');
    }

    const before = await visibleMoney(page);

    expect(before.length).toBeGreaterThan(0);
    expect(before[0]).toContain('$');

    await switcher.selectOption('EUR');
    await expect(page.getByTestId('currency-price')).toBeVisible();

    /*
     * The base price must be *hidden*, not merely overlaid. Asserting on
     * visibility rather than absence, because it is still in the DOM.
     */
    await expect(page.getByTestId('product-price')).toBeHidden();

    const after = await visibleMoney(page);

    expect(after.every((amount) => amount.startsWith('€'))).toBe(true);

    const cookie = (await context.cookies()).find((c) => c.name === 'cf.currency');

    expect(cookie?.value).toBe('EUR');
  });

  test('switching back to the default currency removes the overlay entirely', async ({ page }) => {
    await page.goto(SIMPLE_PRODUCT);

    const switcher = page.locator(CURRENCY_SELECT);

    if ((await switcher.count()) === 0) {
      test.skip(true, 'store offers a single currency');
    }

    await switcher.selectOption('EUR');
    await expect(page.getByTestId('currency-price')).toBeVisible();

    await switcher.selectOption('USD');

    /*
     * Back on the default, the overlay must disappear rather than render a
     * duplicate USD price — the default currency is what the shell already
     * shows, so an overlay there is pure waste and a second origin request.
     */
    await expect(page.getByTestId('currency-price')).toHaveCount(0);
    await expect(page.getByTestId('product-price')).toBeVisible();
  });

  test('an unsupported currency falls back to the default rather than being trusted', async ({
    page,
    context,
  }) => {
    /*
     * The currency reaches a cache key, so an unvalidated value would be an
     * unbounded key space anyone could fill from the address bar.
     * `resolveCurrency` clamps it to the currencies BigCommerce reports as
     * transactional.
     */
    await context.addCookies([
      { name: 'cf.currency', value: 'XYZ', domain: '127.0.0.1', path: '/' },
    ]);

    await page.goto(SIMPLE_PRODUCT);

    await expect(page.getByTestId('product-price')).toBeVisible();
    await expect(page.getByTestId('currency-price')).toHaveCount(0);

    const money = await visibleMoney(page);

    expect(money[0]).toContain('$');
  });

  /*
   * The consent split, which is the easiest thing here to get wrong in a way
   * nobody notices: without `functionality` consent the switch must still work
   * — it is a direct response to a click — but the choice must not outlive the
   * session. Asserting `expires === -1` (Playwright's session-cookie sentinel)
   * rather than "no cookie", because the version that writes nothing produces a
   * switcher that visibly does nothing.
   */
  test('an unconsented shopper still gets the currency, just not remembered', async ({
    page,
    context,
  }) => {
    await context.clearCookies({ name: 'cf.consent' });
    await context.addCookies([
      {
        name: 'cf.consent',
        value: encodeURIComponent(`i.t:${Date.now()},c.necessary:1`),
        domain: '127.0.0.1',
        path: '/',
        expires: -1,
      },
    ]);

    await page.goto(SIMPLE_PRODUCT);

    const switcher = page.locator(CURRENCY_SELECT);

    if ((await switcher.count()) === 0) {
      test.skip(true, 'store offers a single currency');
    }

    await switcher.selectOption('EUR');

    // The click is honoured: euros are on screen.
    await expect(page.getByTestId('currency-price')).toBeVisible();

    const cookie = (await context.cookies()).find((c) => c.name === 'cf.currency');

    expect(cookie?.value).toBe('EUR');
    expect(cookie?.expires).toBe(-1);
  });

  test('a consenting shopper keeps the currency across visits', async ({ page, context }) => {
    await page.goto(SIMPLE_PRODUCT);

    const switcher = page.locator(CURRENCY_SELECT);

    if ((await switcher.count()) === 0) {
      test.skip(true, 'store offers a single currency');
    }

    await switcher.selectOption('EUR');
    await expect(page.getByTestId('currency-price')).toBeVisible();

    // The seeded storage state grants functionality consent, so this one persists.
    const cookie = (await context.cookies()).find((c) => c.name === 'cf.currency');

    expect(cookie?.expires).toBeGreaterThan(Date.now() / 1000);
  });
});
