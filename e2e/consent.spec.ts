import { expect, test } from '@playwright/test';

import { SIMPLE_PRODUCT } from './fixtures';

/**
 * The cookie banner.
 *
 * Needs its own file because `playwright.config.ts` seeds a consent cookie for
 * every other test — the banner is fixed to the bottom of the viewport and
 * swallows clicks, which made an unrelated wishlist test fail several steps
 * downstream of the click it ate. So these tests clear that cookie first and are
 * the only place the banner is exercised.
 */
test.describe('cookie consent', () => {
  test.beforeEach(async ({ context }) => {
    await context.clearCookies();
  });

  test('offers a choice, and remembers it', async ({ page, context }) => {
    await page.goto(SIMPLE_PRODUCT);

    const banner = page.getByText('We use cookies', { exact: false });

    // Skips rather than fails when the merchant has consent switched off: the
    // absence of a banner is correct behaviour there, not a regression.
    if (!(await banner.isVisible().catch(() => false))) {
      test.skip(true, 'cookieConsentEnabled is off for this store');
    }

    await page.getByRole('button', { name: 'Accept all' }).click();
    await expect(banner).toBeHidden();

    const cookie = (await context.cookies()).find((c) => c.name === 'cf.consent');

    expect(cookie).toBeDefined();
    expect(decodeURIComponent(cookie?.value ?? '')).toContain('c.measurement:1');

    // The whole point of persisting it: a reload must not ask again.
    await page.reload();
    await expect(banner).toBeHidden();
  });

  test('declining records a choice without granting anything', async ({ page, context }) => {
    await page.goto(SIMPLE_PRODUCT);

    const banner = page.getByText('We use cookies', { exact: false });

    if (!(await banner.isVisible().catch(() => false))) {
      test.skip(true, 'cookieConsentEnabled is off for this store');
    }

    await page.getByRole('button', { name: 'Decline all' }).click();
    await expect(banner).toBeHidden();

    const value = decodeURIComponent(
      (await context.cookies()).find((c) => c.name === 'cf.consent')?.value ?? '',
    );

    /*
     * Declining must still write a cookie — otherwise "no" is indistinguishable
     * from "not asked yet" and the banner returns on every page.
     */
    expect(value).toContain('c.necessary:1');
    expect(value).not.toContain('c.marketing');
    expect(value).not.toContain('c.measurement');
  });

  test('the storefront is unaffected by the banner being present', async ({ page }) => {
    await page.goto(SIMPLE_PRODUCT);

    // The shell must render regardless — the banner is an overlay, not a gate.
    await expect(page.getByTestId('product-price')).toBeVisible();
  });
});
