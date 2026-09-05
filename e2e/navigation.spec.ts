import { expect, test } from '@playwright/test';

/**
 * Regression cover for the bug class that typecheck, lint, and build all passed
 * three times in a row:
 *
 *  - top-level nav rendered as inert `<span>`s with no href
 *  - "Shop all X" duplicated after the nav query was split
 *  - refinement links built from the internal `/category/98` path
 *
 * Every one of those is invisible to static analysis and obvious in a browser.
 */

test.describe('header navigation', () => {
  test('every top-level item is navigable', async ({ page }) => {
    await page.goto('/');

    const items = page.locator('nav[aria-label="Main"] > nav > ul > li');
    const count = await items.count();

    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const item = items.nth(index);
      const link = item.locator('a');
      const trigger = item.locator('button');

      // A category is either a direct link, or a disclosure whose panel contains
      // a link to the category. It must never be inert text.
      if ((await link.count()) > 0) {
        await expect(link.first()).toHaveAttribute('href', /\S/);
      } else {
        await expect(trigger.first()).toBeVisible();
      }
    }
  });

  test('a category with children opens a panel with exactly one "Shop all" link', async ({
    page,
  }) => {
    await page.goto('/');

    const trigger = page.locator('nav[aria-label="Main"] button').first();

    await trigger.click();

    const shopAll = page.getByRole('link', { name: /^Shop all / });

    await expect(shopAll).toHaveCount(1);
    await expect(shopAll).toHaveAttribute('href', /\S/);
  });

  test('clicking a top-level link navigates to the vanity URL', async ({ page }) => {
    await page.goto('/');

    const link = page.locator('nav[aria-label="Main"] a').first();
    const href = await link.getAttribute('href');

    await link.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    // Scoped to the last h1: during a client-side transition the previous page's
    // heading is still in the DOM (hidden), which makes a bare `h1` ambiguous.
    await expect(page.getByRole('heading', { level: 1 }).last()).toBeVisible();
  });
});

test.describe('internal routes', () => {
  test('are not reachable directly', async ({ page }) => {
    // These exist only as proxy rewrite targets. Without the guard they return
    // 200 with a not-found body, because notFound() cannot set a status after a
    // PPR shell has flushed.
    for (const path of ['/category/999999/', '/brand/999999/']) {
      const response = await page.goto(path);

      expect(response?.status(), `${path} should 404`).toBe(404);
    }
  });

  test('a bogus vanity URL 404s', async ({ page }) => {
    const response = await page.goto('/definitely-not-a-real-category/');

    expect(response?.status()).toBe(404);
  });
});
