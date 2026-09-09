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
