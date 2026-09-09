import { expect, test } from '@playwright/test';

import { CATEGORY } from './fixtures';



test.describe('listing page shell', () => {
  test('prerenders real content, not skeletons', async ({ page }) => {
    // The Phase 2 bar: the unfiltered view is in the static shell. If this
    // regresses the page still *works*, so only an assertion catches it.
    await page.goto(CATEGORY);

    await expect(page.getByRole('heading', { level: 1 }).last()).toHaveText(/\S/);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    // `.last()` throughout: a PPR document holds both the cached fallback and
    // the streamed result, so a bare match is ambiguous.
    await expect(page.getByTestId('result-count').last()).toBeVisible();
    await expect(page.locator('article').first()).toBeVisible();
  });

  test('renders facet groups', async ({ page }) => {
    await page.goto(CATEGORY);

    await expect(page.locator('details summary').first()).toBeVisible();
  });
});

test.describe('refinement', () => {
  test('facet links stay on the vanity URL', async ({ page }) => {
    // The bug this guards: links were built from the internal `/category/98`
    // path, which bounced shoppers off the vanity URL and leaked internal paths
    // into the HTML for crawlers to follow.
    await page.goto(CATEGORY);

    const hrefs = await page.locator(`a[href*="${CATEGORY}?"]`).evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('href') ?? ''),
    );

    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs.every((href) => href.startsWith(CATEGORY))).toBe(true);

    const internal = await page.locator('a[href^="/category/"], a[href^="/brand/"]').count();

    expect(internal, 'no internal route paths should appear in the HTML').toBe(0);
  });

  /*
   * Runs against `/shop-all/`, not `CATEGORY`.
   *
   * `/garden/` holds two products and its only visible facets are star ratings
   * and boolean toggles, none of which render a count and none of which
   * reliably narrow a two-item set — so the original "click the first option and
   * assert the count changed" failed roughly one run in three depending on which
   * option it landed on. `/shop-all/` has 13 products and 17 counted options,
   * which is what makes a deterministic assertion possible at all.
   */
  test('applying a facet narrows the result count', async ({ page }) => {
    await page.goto('/shop-all/');

    const countOf = async (): Promise<number> => {
      const text = await page.getByTestId('result-count').last().innerText();

      return Number(/\d+/.exec(text)?.[0] ?? '0');
    };

    const before = await countOf();

    /*
     * Facet groups render as `<details>`, and a collapsed one hides its links —
     * which group is open depends on the merchant's `isCollapsedByDefault`, so a
     * bare `.first()` can latch onto an option that never becomes clickable.
     */
    for (const group of await page.locator('details').all()) {
      await group.evaluate((element) => ((element as HTMLDetailsElement).open = true));
    }

    /*
     * Pick an option whose own product count is **strictly less** than the
     * current total, rather than simply the first one available.
     *
     * A facet that matches every product in the category is a legitimate thing
     * for a merchant to have, and clicking it narrows nothing — so the old
     * "click the first option and assert the count changed" was a coin flip that
     * failed roughly one run in three. Each option renders its own count, so the
     * test can choose one that must narrow.
     */
    const options = await page.locator('details a[aria-pressed="false"]').filter({ visible: true }).all();
    let target: (typeof options)[number] | undefined;
    let expected = 0;

    for (const option of options) {
      // The count is the trailing number in "Sagaform 1"; label and count are
      // inline spans, so there is no newline to split on.
      const count = Number(/(\d+)\s*$/.exec((await option.innerText()).replace(/\s+/g, ' ').trim())?.[1] ?? '0');

      if (count > 0 && count < before) {
        target = option;
        expected = count;
        break;
      }
    }

    test.skip(!target, 'no facet in this category narrows the result set');

    await target?.click();
    await page.waitForURL(/\?/);

    await expect(page.getByTestId('result-count').last()).toContainText(String(expected));
    await expect(page).toHaveURL(/^[^?]*\/shop-all\/\?/);
  });

  test('sorting updates the URL without leaving the vanity path', async ({ page }) => {
    await page.goto(CATEGORY);

    await page.getByLabel('Sort').selectOption('price-asc');
    await page.waitForURL(/sort=price-asc/);

    await expect(page).toHaveURL(new RegExp(`^[^?]*${CATEGORY}\\?.*sort=price-asc`));
  });

  test('tracking params do not change the rendered result', async ({ page }) => {
    // Canonicalization property, end to end: `?utm_source=…` must resolve to the
    // same cache entry as the bare URL.
    await page.goto(CATEGORY);
    const bare = await page.getByTestId('result-count').last().innerText();

    await page.goto(`${CATEGORY}?utm_source=newsletter&fbclid=abc`);

    await expect(page.getByTestId('result-count').last()).toHaveText(bare);
  });
});

test.describe('pagination', () => {
  test('advances to a different set of products', async ({ page }) => {
    await page.goto(CATEGORY);

    const next = page.getByRole('link', { name: 'Next' });

    test.skip((await next.count()) === 0, 'category has a single page of products');

    const firstTitle = await page.locator('article h3').first().innerText();

    await next.click();
    await page.waitForURL(/after=/);

    await expect(page.locator('article h3').first()).not.toHaveText(firstTitle);
    await expect(page.getByRole('link', { name: 'Previous' })).toBeVisible();
  });
});

test.describe('empty state', () => {
  test('shows a message rather than an empty grid', async ({ page }) => {
    await page.goto(`${CATEGORY}?minPrice=999999`);

    await expect(page.getByText('No products found')).toBeVisible();
  });
});
