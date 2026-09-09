import { expect, test } from '@playwright/test';

import { CATEGORY, SIMPLE_PRODUCT } from './fixtures';

/**
 * Locale routing and translation.
 *
 * The properties worth protecting, in order of how quietly they break:
 *
 *  1. **English URLs are unchanged.** The `[locale]` segment exists internally,
 *     but the default locale's prefix is hidden by the proxy. A regression here
 *     silently changes every indexed URL on the store.
 *  2. **`/en/…` redirects to the clean URL.** Otherwise two URLs serve one page,
 *     which splits the cache and looks like duplicate content to a crawler.
 *  3. **Money is formatted for the locale, not just translated.** `77,75 €` is
 *     not `€77.75`; getting this wrong looks fine to whoever wrote it.
 */
test.describe('locale', () => {
  test('English keeps unprefixed URLs and English chrome', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByText('Featured products')).toBeVisible();
  });

  test('Spanish is served from its prefix, with translated chrome', async ({ page }) => {
    await page.goto('/es/');

    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.getByText('Productos destacados')).toBeVisible();
  });

  /*
   * The default locale must have exactly one canonical URL. `/en/x` and `/x`
   * both rendering would fragment the cache and split ranking signals.
   */
  test('the default locale redirects its prefix away', async ({ page }) => {
    const response = await page.goto(`/en${CATEGORY}`);

    expect(response?.status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`${CATEGORY}$`));
  });

  test('deep Spanish routes work, not just the home page', async ({ page }) => {
    await page.goto(`/es${CATEGORY}`);

    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    // Listing chrome comes from the Spanish catalogue.
    await expect(page.getByRole('button', { name: 'Ordenar' }).or(page.getByText('Ordenar'))).toBeVisible();
  });

  test('money is formatted for the locale, not merely converted', async ({ page }) => {
    await page.goto(SIMPLE_PRODUCT);
    const english = (await page.getByTestId('product-price').first().innerText()).trim();

    await page.goto(`/es${SIMPLE_PRODUCT}`);
    const spanish = (await page.getByTestId('product-price').first().innerText()).trim();

    // en-US: symbol first, dot decimal. es-ES: symbol last, comma decimal.
    expect(english).toMatch(/^\$\d/);
    expect(spanish).toMatch(/\d,\d{2}\s?€$/);
  });

  /*
   * The regression that prompted this: switch to Spanish on a PDP, click the
   * header logo, land back in English.
   *
   * Every existing test here navigates to `/es/...` by URL, so none of them ever
   * exercised an outgoing link — which is exactly where the bug lived. Clicking
   * is the point of these two.
   */
  test('the header logo keeps a Spanish shopper in Spanish', async ({ page }) => {
    await page.goto(`/es${SIMPLE_PRODUCT}`);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');

    await page.getByRole('banner').getByRole('link').first().click();

    await expect(page).toHaveURL(/\/es\/?$/);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  });

  test('following catalog links from a Spanish page stays in Spanish', async ({ page }) => {
    await page.goto('/es/');

    /*
     * Catalog paths come from BigCommerce as `/garden/` and know nothing about
     * locale, so this is the case that cannot be fixed at the data layer.
     */
    const link = page.getByRole('main').getByRole('link', { name: /.+/ }).first();
    const href = await link.getAttribute('href');

    expect(href).toMatch(/^\/es\//);

    await link.click();
    await expect(page).toHaveURL(/\/es\//);
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  });

  /*
   * Listing *cards* price separately from the PDP, and only the PDP was covered.
   * The cards took their prices from `searchProducts`, whose `currencyCode` was
   * dropped by `defaultKey` — so the Spanish shell was built in the channel's
   * currency and rendered `89,00 US$`: Spanish number formatting wrapped around
   * the wrong currency, then visibly replaced by euros.
   */
  test('listing cards price in the locale currency, not the channel default', async ({ page }) => {
    await page.goto(`/es${CATEGORY}`);

    const main = page.getByRole('main');

    // es-ES formats EUR as `86,50 €` — comma decimal, symbol last.
    await expect(main).toContainText(/\d+,\d{2}\s?€/u);

    /*
     * And crucially *no* USD anywhere. The bug rendered `89,00 US$` in the shell
     * before euros streamed in, so asserting only on the euro would have passed
     * against the broken build.
     */
    await expect(main).not.toContainText('US$');
  });

  test('English listing cards are unaffected', async ({ page }) => {
    await page.goto(CATEGORY);

    const main = page.getByRole('main');

    await expect(main).toContainText(/\$\d+\.\d{2}/u);
    await expect(main).not.toContainText('€');
  });

  test('the language switcher preserves the current page', async ({ page }) => {
    await page.goto(CATEGORY);

    const switcher = page.locator('select[aria-label="Language"]');

    if ((await switcher.count()) === 0) {
      test.skip(true, 'single-locale store');
    }

    await switcher.selectOption('es');

    // Same page, other language — not a bounce to the home page, which is what
    // a naive switcher does.
    await expect(page).toHaveURL(new RegExp(`/es${CATEGORY}$`));
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  });
});
