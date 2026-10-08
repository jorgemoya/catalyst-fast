import { instant } from '@next/playwright';
import { expect, type Page, test } from '@playwright/test';

import { CATEGORY, SIMPLE_PRODUCT, waitForHydration } from './fixtures';

/**
 * Instant navigation: what a click shows **before the server answers**.
 *
 * `instant()` holds back everything that isn't already prefetched, so whatever
 * is visible inside it is what a shopper sees at the moment of the click. The
 * rest of the suite waits for content to appear *eventually*, which is why a
 * full-page skeleton on every first product click shipped unnoticed: those
 * tests passed straight through it. This file is the plan's Part 8 layer 3,
 * which existed only on paper until then.
 *
 * **Needs `pnpm build:e2e`.** `instant()` is a no-op against a normal
 * production build; the first test checks the lock is actually held.
 *
 * The product and category pages depend on `params`, which the shared App
 * Shell can't carry. Their content is ready on click only because `Link`
 * upgrades to a per-link prefetch on intent — hover, touch, focus — and these
 * tests hover first, as a shopper's pointer does.
 */

/** Hover a link and give its per-link prefetch time to land. */
async function hoverAndPrefetch(page: Page, link: ReturnType<Page['locator']>) {
  const prefetched = page.waitForResponse(
    (response) => response.request().headers()['next-router-prefetch'] !== undefined,
  );

  await link.hover();
  await prefetched;
  // A prefetch can be several requests (route tree, then segments). Not
  // `networkidle`: after a currency switch the page never settles into it.
  await page.waitForTimeout(1500);
}

test.describe('instant navigation', () => {
  test('a hovered product opens with its content, not a skeleton', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page, 'main a[href]');

    // The title link: it carries the card's click overlay.
    const card = page.locator('main article a[href]').filter({ hasText: /\S/ }).first();
    const name = (await card.innerText()).trim();

    await hoverAndPrefetch(page, card);

    await instant(page, async () => {
      await card.click();

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

      /*
       * Proof the lock is real: default price and stock render at request time
       * (`StreamedDefaultVariant`), so inside `instant()` they must not have
       * arrived — no price yet, CTA disabled. If this fails, the build lacks the
       * testing API (`pnpm build:e2e`) and every assertion above passed for the
       * wrong reason.
       */
      await expect(page.getByTestId('product-price')).toHaveCount(0);
      await expect(page.getByTestId('add-to-cart')).toBeDisabled();
    });

    // And once released, they stream into the same form.
    await expect(page.getByTestId('product-price')).toHaveText(/\d/);
    await expect(page.getByTestId('add-to-cart')).toBeEnabled();
  });

  test('a hovered category opens with its products, not a skeleton', async ({ page }) => {
    await page.goto('/');
    await waitForHydration(page, 'main a[href]');

    const link = page.locator(`a[href="${CATEGORY}"]`).filter({ visible: true }).first();
    const name = (await link.innerText()).trim();

    await hoverAndPrefetch(page, link);

    await instant(page, async () => {
      await link.click();

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
      // Card prices are cached with the grid (`listing`), so they arrive with
      // it — no per-card placeholders.
      await expect(page.locator('main article').filter({ visible: true }).first()).toContainText(
        /[$€£]\s?\d/u,
      );
    });
  });

  /*
   * The home page is shared and static: its product rows carry no prices, so
   * nothing on it depends on the shopper — not even currency.
   */
  test('home product rows show no prices', async ({ page }) => {
    await page.goto('/');

    const cards = page.locator('main article');

    await expect(cards.first()).toBeVisible();
    await expect(cards.first()).not.toContainText(/[$€£]\s?\d/u);
  });

  // Merchandising, like home: the live price is on the product's own page.
  test('related products show no prices', async ({ page }) => {
    await page.goto(SIMPLE_PRODUCT);

    const related = page.locator('section', {
      has: page.getByRole('heading', { name: 'You might also like' }),
    });

    await expect(related.locator('article').first()).toBeVisible();
    await expect(related).not.toContainText(/[$€£]\s?\d/u);
  });

  /*
   * A shopper on another currency gets their price from the overlay, which used
   * to be cached *with* the page — and its 5-minute `stale` then capped the
   * whole page at five minutes for them. It's request-time now, like the
   * default price.
   */
  test('a converted price streams, it is not cached with the page', async ({ page }) => {
    await page.goto('/');

    const switcher = page.locator('select[aria-label="Currency"]');

    test.skip((await switcher.count()) === 0, 'store offers a single currency');

    const options = await switcher.locator('option').evaluateAll((items) =>
      items.map((item) => (item as HTMLOptionElement).value),
    );
    const other = options.find((value) => value !== (options[0] ?? ''));

    test.skip(!other, 'store offers a single currency');

    await switcher.selectOption(other ?? '');
    await waitForHydration(page, 'main a[href]');

    const card = page.locator('main article a[href]').filter({ hasText: /\S/ }).first();
    const name = (await card.innerText()).trim();

    await hoverAndPrefetch(page, card);

    await instant(page, async () => {
      await card.click();

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
      await expect(page.getByTestId('currency-price')).toHaveCount(0);
    });

    await expect(page.getByTestId('currency-price')).toBeVisible();
  });

  test('revisiting a product within five minutes needs no server at all', async ({ page }) => {
    test.setTimeout(90_000);

    await page.goto('/');
    await waitForHydration(page, 'main a[href]');

    const card = page.locator('main article a[href]').filter({ hasText: /\S/ }).first();
    const name = (await card.innerText()).trim();

    await card.click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);

    await page.getByRole('banner').getByRole('link').first().click();
    await expect(card).toBeVisible();

    /*
     * Past the old 30-second window: per-shopper entries with `stale: 30` used
     * to make the browser drop the whole product page after half a minute. See
     * the `session` profile in `lib/cache/profiles.ts`.
     */
    await page.waitForTimeout(35_000);

    await instant(page, async () => {
      await card.click();

      await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
    });
  });
});
