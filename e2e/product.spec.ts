import { expect, test } from '@playwright/test';

/** A simple product with no options. */
const SIMPLE = '/zz-plant/';
/** Two RectangleBoxes options (Size, Color) — the variant-selection path. */
const WITH_OPTIONS = '/the-cylinder-by-modern-botany/';

test.describe('product detail shell', () => {
  test('contains everything the Phase 3 bar requires', async ({ page }) => {
    // Title, gallery, description, specs, default price, default stock, CTA —
    // all server-rendered, no interaction required.
    await page.goto(SIMPLE);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toBeVisible();
    await expect(page.getByTestId('product-price')).toBeVisible();
    await expect(page.getByTestId('product-price')).toHaveText(/\d/);
    await expect(page.getByTestId('add-to-cart')).toBeVisible();
    await expect(page.getByTestId('product-availability')).toBeAttached();
    await expect(page.getByRole('heading', { name: 'Specifications' })).toBeVisible();
  });

  test('renders a gallery with selectable thumbnails', async ({ page }) => {
    await page.goto(SIMPLE);

    const thumbs = page.getByRole('button', { name: /View image \d+ of/ });

    // Web-first assertion before counting: `count()` does not auto-wait, and on a
    // cold cache the PDP body streams in after `load`, so a bare count races the
    // stream and intermittently sees zero.
    await expect(thumbs.first()).toBeVisible();
    expect(await thumbs.count()).toBeGreaterThan(1);

    await thumbs.nth(1).click();
    await expect(thumbs.nth(1)).toHaveAttribute('aria-current', 'true');
  });

  test('emits valid Product structured data', async ({ page }) => {
    await page.goto(SIMPLE);

    const raw = await page.locator('script[type="application/ld+json"]').innerText();
    const schema: Record<string, unknown> = JSON.parse(raw);

    expect(schema['@type']).toBe('Product');
    expect(schema.name).toEqual(expect.any(String));
    expect(schema.offers).toMatchObject({ priceCurrency: expect.any(String) });
    // An aggregateRating with zero reviews is a structured-data error, so it must
    // only appear when reviews exist.
    if (schema.aggregateRating) {
      expect(schema.aggregateRating).toMatchObject({ reviewCount: expect.any(Number) });
    }
  });

  test('shows related products and reviews', async ({ page }) => {
    await page.goto(SIMPLE);

    await expect(page.getByRole('heading', { name: 'You might also like' })).toBeVisible();
    await expect(page.locator('#reviews')).toBeAttached();
  });
});

test.describe('variant selection', () => {
  test('renders one control per option', async ({ page }) => {
    await page.goto(WITH_OPTIONS);

    const groups = page.locator('fieldset');

    expect(await groups.count()).toBeGreaterThan(0);
  });

  test('selecting an option updates the URL without navigating', async ({ page }) => {
    await page.goto(WITH_OPTIONS);

    // Capture the label *before* clicking: `[aria-pressed="false"]` is a live
    // locator, so once this button flips to true it re-resolves to the next
    // unselected one and the assertion would read the wrong element.
    const label = await page
      .locator('fieldset button[aria-pressed="false"]')
      .first()
      .innerText();

    await page.locator('fieldset button', { hasText: label }).first().click();

    // `replaceState`, not a router push — so the URL carries the selection but no
    // navigation occurred and the page was never re-rendered from the server.
    await expect(page).toHaveURL(/\?/);
    await expect(page.locator('fieldset button', { hasText: label }).first()).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('a deep-linked selection is applied on load', async ({ page }) => {
    await page.goto(WITH_OPTIONS);
    await page.locator('fieldset button[aria-pressed="false"]').first().click();
    await expect(page).toHaveURL(/\?/);

    const deepLink = page.url();

    await page.goto(deepLink);

    // The server renders the default variant; the client reconciles from the URL
    // after hydration. Both halves have to work for this to pass.
    await expect(page.locator('fieldset button[aria-pressed="true"]').first()).toBeVisible();
  });

  test('price and CTA stay present through a selection change', async ({ page }) => {
    await page.goto(WITH_OPTIONS);

    await expect(page.getByTestId('product-price')).toHaveText(/\d/);
    await page.locator('fieldset button[aria-pressed="false"]').first().click();

    // The snapshot is refetched from cached reads; it must never blank out.
    await expect(page.getByTestId('product-price')).toHaveText(/\d/);
    await expect(page.getByTestId('add-to-cart')).toBeVisible();
  });
});

test.describe('required options', () => {
  test('the CTA is disabled until every required option is chosen', async ({ page }) => {
    // BigCommerce products need not define a default for every option, so a PDP
    // can load with required options unselected. Offering "Add to cart" then
    // would either fail at the API or add the wrong variant.
    await page.goto(WITH_OPTIONS);

    const cta = page.getByTestId('add-to-cart');
    const groups = page.locator('fieldset');
    const groupCount = await groups.count();

    // The initial state is the point of this test: this product defines no
    // default for either required option, so the CTA must start disabled and say
    // what is missing.
    await expect(cta).toBeDisabled();
    await expect(cta).toHaveText(/^Select /);

    // Choose one value in each group.
    for (let index = 0; index < groupCount; index += 1) {
      const unset = groups.nth(index).locator('button[aria-pressed="false"]').first();

      if (await unset.count()) {
        await unset.click();
      }
    }

    await expect(cta).toBeEnabled();
  });
});

test.describe('product routes', () => {
  test('the internal route is not reachable directly', async ({ page }) => {
    const response = await page.goto('/product/999999/');

    expect(response?.status()).toBe(404);
  });
});
