import { expect, test } from '@playwright/test';

/**
 * Customer-group catalog visibility (`RESTRICTED_CATALOG_GROUPS`).
 *
 * BigCommerce resolves visibility from the caller's token, and the shared guest
 * cache is fetched with no token — so a shopper whose group can see more than
 * guests got the *guest* catalog: 404 on the restricted product and category,
 * and silently incomplete search and navigation.
 *
 * Fixture, configured on the test store: guests belong to a guest group whose
 * category access excludes "Hidden Category"; the test customer's group can see
 * it; product "Copy of [Sample] Utility Caddy" lives only in that category.
 * Skips when that fixture is absent, since most stores restrict nothing.
 */
const RESTRICTED_PRODUCT = '/copy-of-sample-utility-caddy/';
const RESTRICTED_CATEGORY = '/hidden-category/';

const email = process.env.E2E_CUSTOMER_EMAIL;
const password = process.env.E2E_CUSTOMER_PASSWORD;

test.describe.configure({ mode: 'serial' });

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(email ?? '');
  await page.getByLabel('Password').fill(password ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/orders/u);
}

test.describe('restricted catalog', () => {
  test.skip(!email || !password, 'needs the signed-in fixture customer');
  test.skip(!process.env.RESTRICTED_CATALOG_GROUPS, 'RESTRICTED_CATALOG_GROUPS is not configured');

  test('guests still cannot see the restricted product or category', async ({ page }) => {
    expect((await page.goto(RESTRICTED_PRODUCT))?.status()).toBe(404);
    expect((await page.goto(RESTRICTED_CATEGORY))?.status()).toBe(404);
  });

  test('a customer in a restricted group can open the product', async ({ page }) => {
    await signIn(page);

    const response = await page.goto(RESTRICTED_PRODUCT);

    expect(response?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Copy of');
  });

  test('and the category, with the product listed', async ({ page }) => {
    await signIn(page);

    expect((await page.goto(RESTRICTED_CATEGORY))?.status()).toBe(200);
    await expect(page.getByRole('main')).toContainText('Copy of');
  });

  test('and finds it in search', async ({ page }) => {
    await signIn(page);
    await page.goto('/search/?term=caddy');

    await expect(page.getByRole('main')).toContainText('Copy of');
  });

  test('and sees the category in navigation', async ({ page }) => {
    await signIn(page);
    await page.goto('/');

    await expect(page.getByRole('banner')).toContainText('Hidden Category');
  });

  /*
   * **The leak test.** The restricted catalog is fetched with one shopper's
   * token; if any of it reached a shared cache — the proxy's KV route cache, a
   * `use cache` entry, the prerendered shell — the *next guest* would be served
   * it. So: a restricted shopper renders every restricted surface first, then a
   * completely separate guest session asks for the same URLs.
   */
  test('nothing a restricted shopper rendered reaches a guest', async ({ page, browser }) => {
    await signIn(page);

    for (const path of [RESTRICTED_PRODUCT, RESTRICTED_CATEGORY, '/search/?term=caddy', '/']) {
      await page.goto(path);
    }

    const guest = await browser.newContext();
    const guestPage = await guest.newPage();

    expect((await guestPage.goto(RESTRICTED_PRODUCT))?.status()).toBe(404);
    expect((await guestPage.goto(RESTRICTED_CATEGORY))?.status()).toBe(404);

    await guestPage.goto('/search/?term=caddy');
    await expect(guestPage.getByRole('main')).not.toContainText('Copy of');

    await guestPage.goto('/');
    await expect(guestPage.getByRole('banner')).not.toContainText('Hidden Category');

    await guest.close();
  });

  /*
   * Signing out must drop the shopper straight back to the guest catalog —
   * nothing from the restricted view may linger in any cache.
   */
  test('signing out returns the guest catalog', async ({ page }) => {
    await signIn(page);
    expect((await page.goto(RESTRICTED_PRODUCT))?.status()).toBe(200);

    // `/logout/` is a confirmation form (a GET must not sign anyone out).
    await page.goto('/logout/');
    await page.getByRole('main').getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL((url) => !url.pathname.startsWith('/logout'));

    expect((await page.goto(RESTRICTED_PRODUCT))?.status()).toBe(404);
  });
});
