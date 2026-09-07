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

  test('applying a facet narrows the result count', async ({ page }) => {
    await page.goto(CATEGORY);

    const before = await page.getByTestId('result-count').last().innerText();

    /*
     * Facet groups render as `<details>`, and a collapsed one hides its links —
     * which group is open depends on the merchant's `isCollapsedByDefault`, so a
     * bare `.first()` can latch onto an option that never becomes clickable.
     * Open every group first, then take the first visible unselected option.
     */
    for (const group of await page.locator('details').all()) {
      await group.evaluate((element) => (element as HTMLDetailsElement).open = true);
    }

    await page.locator('details a[aria-pressed="false"]').filter({ visible: true }).first().click();
    await page.waitForURL(/\?/);

    await expect(page.getByTestId('result-count').last()).not.toHaveText(before);
    await expect(page).toHaveURL(new RegExp(`^[^?]*${CATEGORY}\\?`));
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
