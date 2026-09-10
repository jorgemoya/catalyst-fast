import { expect, test } from '@playwright/test';

import { PRODUCT_WITH_OPTIONS, SIMPLE_PRODUCT } from './fixtures';


/**
 * Phase 4's acceptance bar: a guest can go home → PLP → PDP → cart → checkout
 * without an account, and the header badge is correct at every step.
 *
 * Each test starts from a fresh browser context (Playwright's default), so the
 * cart cookie never leaks between them.
 */

test.describe('add to cart', () => {
  test('updates the header badge on the FIRST click', async ({ page }) => {
    /*
     * The regression test for the `updateTag` + `refresh()` contract.
     *
     * The badge is a `'use cache: private'` scope, which lives in the browser's
     * memory — `updateTag` alone cannot reach it. Drop the `refresh()` from
     * `lib/cart/revalidate.ts` and everything still appears to work: the cart
     * page updates, and this badge eventually catches up on the next navigation.
     * It fails here, on the first click, which is the only place the bug is
     * visible.
     */
    await page.goto(SIMPLE_PRODUCT);

    await expect(page.getByTestId('cart-count')).toHaveCount(0);

    await page.getByTestId('add-to-cart').click();

    await expect(page.getByTestId('add-to-cart-success')).toBeVisible();
    await expect(page.getByTestId('cart-count')).toHaveText('1');
  });

  test('respects the quantity stepper', async ({ page }) => {
    await page.goto(SIMPLE_PRODUCT);

    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await page.getByTestId('add-to-cart').click();

    await expect(page.getByTestId('cart-count')).toHaveText('3');
  });

  test('adds to an existing cart rather than starting a new one', async ({ page }) => {
    // The `cartExists` → `addCartLineItems` branch, which the create path never
    // exercises. Getting it wrong is invisible on the first add and loses the
    // shopper's cart on the second.
    await page.goto(SIMPLE_PRODUCT);

    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('2');

    await page.goto('/cart');
    await expect(page.getByTestId('cart-items').getByRole('listitem')).toHaveCount(1);
    await expect(page.getByTestId('cart-item-count')).toHaveText('2 items');
  });

  test('recovers from a cookie pointing at a cart that no longer exists', async ({
    page,
    context,
  }) => {
    /*
     * Carts expire at BigCommerce and are consumed at checkout, and the browser
     * knows neither. Without the existence check in `addToOrCreateCart` this
     * throws instead of quietly starting a fresh cart.
     */
    // Navigate first so the cookie can be scoped to the real origin, whatever
    // port the suite is running on.
    await page.goto(SIMPLE_PRODUCT);

    await context.addCookies([
      { name: 'cf.cart', value: '00000000-0000-4000-8000-000000000000', url: page.url() },
    ]);

    await page.reload();
    await page.getByTestId('add-to-cart').click();

    await expect(page.getByTestId('cart-count')).toHaveText('1');
  });

  test('carries a variant selection into the cart', async ({ page }) => {
    await page.goto(PRODUCT_WITH_OPTIONS);

    /*
     * Every required option group has to be answered, not just the first: the CTA
     * stays disabled with "Select Color" until each one is, which is the intended
     * behavior and was what caught this test out. Picking the second value of
     * each group keeps the test from encoding this store's catalog.
     */
    const groups = page.locator('fieldset');
    const chosen: string[] = [];

    for (let index = 0; index < (await groups.count()); index += 1) {
      const choices = groups.nth(index).getByRole('button');
      const choice = choices.nth(Math.min(1, (await choices.count()) - 1));

      chosen.push(((await choice.textContent()) ?? '').trim());
      await choice.click();
      await expect(choice).toHaveAttribute('aria-pressed', 'true');
    }

    // Dropdown options render as a <select> outside any fieldset, so they need
    // answering separately from the button groups above.
    for (const select of await page.locator('select[name^="option."]').all()) {
      const values = await select.locator('option').evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value).filter(Boolean),
      );

      if (values[0]) {
        await select.selectOption(values[0]);
        chosen.push(((await select.locator(`option[value="${values[0]}"]`).textContent()) ?? '').trim());
      }
    }

    await expect(page.getByTestId('add-to-cart')).toBeEnabled();
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.goto('/cart');

    for (const value of chosen.filter(Boolean)) {
      await expect(page.getByTestId('cart-items')).toContainText(value);
    }
  });
});

test.describe('cart page', () => {
  test('shows an empty state for a guest with no cart', async ({ page }) => {
    await page.goto('/cart');

    await expect(page.getByTestId('cart-empty')).toBeVisible();
    await expect(page.getByTestId('checkout')).toHaveCount(0);
  });

  test('lists what was added, with a total and a checkout link', async ({ page }) => {
    await page.goto(SIMPLE_PRODUCT);
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.goto('/cart');

    await expect(page.getByTestId('cart-item-count')).toHaveText('1 item');
    await expect(page.getByTestId('cart-items').getByRole('listitem')).toHaveCount(1);
    await expect(page.getByText('Order summary')).toBeVisible();
    await expect(page.getByTestId('checkout')).toBeVisible();
  });

  test('changes quantity and removes a line', async ({ page }) => {
    await page.goto(SIMPLE_PRODUCT);
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.goto('/cart');

    await page.getByTestId('cart-items').getByRole('button', { name: 'Increase quantity' }).click();
    await expect(page.getByTestId('cart-item-count')).toHaveText('2 items');
    await expect(page.getByTestId('cart-count')).toHaveText('2');

    await page.getByTestId('cart-items').getByRole('button', { name: /^Remove / }).click();

    // Removing the last line deletes the cart at BigCommerce and clears the
    // cookie, so this lands on the empty state rather than an orphaned cart.
    await expect(page.getByTestId('cart-empty')).toBeVisible();
    await expect(page.getByTestId('cart-count')).toHaveCount(0);
  });

  test('rejects an invalid coupon in place, without an error page', async ({ page }) => {
    await page.goto(SIMPLE_PRODUCT);
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.goto('/cart');

    await page.getByLabel('Coupon code').fill('DEFINITELY-NOT-A-REAL-CODE');
    await page.getByRole('button', { name: 'Apply' }).click();

    // Scoped by test id, not `getByRole('alert')`: Next renders a permanently
    // present, empty route-announcer with that role, which a bare role query
    // matches first.
    await expect(page.getByTestId('coupon-error')).toContainText(/coupon/i);
    // Still on the cart, still with the item — a bad code is a field error.
    await expect(page.getByTestId('cart-items')).toBeVisible();
  });
});

test.describe('checkout handoff', () => {
  test('sends an empty cart back to the cart page', async ({ page }) => {
    const response = await page.goto('/checkout/');

    expect(response?.url()).toContain('/cart');
    await expect(page.getByTestId('cart-empty')).toBeVisible();
  });

  test('redirects a populated cart to BigCommerce', async ({ page }) => {
    await page.goto(SIMPLE_PRODUCT);
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    // Trailing slash matters here: `trailingSlash: true` means a raw `/checkout`
    // is a 308 to `/checkout/` and never reaches the handler. Following redirects
    // would hide that, so the request is made against the canonical path.
    const response = await page.request.get('/checkout/', { maxRedirects: 0 });

    expect(response.status()).toBe(302);
    expect(response.headers().location).toMatch(/^https?:\/\//);
    expect(response.headers()['cache-control']).toContain('no-store');
  });
});

test.describe('guest journey', () => {
  test('home → category → product → cart', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('navigation', { name: 'Main' }).getByRole('link').first().click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await expect(page).toHaveURL(/\/[a-z0-9-]+\/$/);

    /*
     * `visible: true` is load-bearing, and the reason is worth recording: the
     * listing renders its default grid inside a nested Suspense fallback (plan
     * §4.4) so the unfiltered view lands in the static shell. Mid-stream that
     * leaves *two* copies of the grid in the DOM, and React marks one hidden — so
     * a plain `.first()` can latch onto a card that will never become clickable.
     *
     * `hasText` then picks the card's title link rather than its image link,
     * which is an `aspect-square` block whose height derives from its width.
     */
    const card = page.locator('article').filter({ visible: true }).first();

    await expect(card).toBeVisible();
    await card.getByRole('link').filter({ hasText: /\S/ }).first().click();
    await expect(page.getByTestId('add-to-cart')).toBeVisible();

    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.getByRole('link', { name: /^Cart/ }).click();
    await expect(page.getByTestId('cart-items')).toBeVisible();
  });
});

/**
 * Shipping estimator.
 *
 * The quotes used to render as a read-only list: a shopper could see that one
 * method costs more and had no way to take it, so the consignment kept whatever
 * BigCommerce defaulted to. Selecting is the half that was missing.
 *
 * Writes to the shopper's own cart, which is created fresh by this test and
 * abandoned after — no merchant-visible record, unlike an order.
 */
test.describe('shipping estimator', () => {
  test('quotes an address and applies the chosen method', async ({ page }) => {
    await page.goto(SIMPLE_PRODUCT);
    await page.getByTestId('add-to-cart').click();
    // Wait for the badge before navigating: the cart cookie is set by the
    // action, and going to /cart/ first lands on the empty state.
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.goto('/cart');

    const country = page.locator('select[name="countryCode"]');

    await expect(country).toBeVisible();
    await country.selectOption({ label: 'United States' });

    /*
     * A coherent address. An arbitrary state paired with a Beverly Hills
     * postcode quotes nothing, which the test then reads as "store does not ship
     * here" and skips — passing while proving nothing.
     */
    const state = page.locator('select[name="state"]');

    await expect(state).toBeVisible();
    await state.selectOption({ label: 'California' });
    await page.locator('input[name="city"]').fill('Beverly Hills');
    await page.locator('input[name="postalCode"]').fill('90210');
    await page.getByRole('button', { name: /Estimate|Calcular/ }).click();

    const apply = page.getByTestId('apply-shipping');
    const noOptions = page.getByText('No shipping options are available');

    /*
     * The panel must never go blank. It used to render only its heading between
     * the form collapsing and the action resolving, so a submission looked
     * swallowed for a second or more.
     *
     * Asserted on the pending element *specifically*. The weaker "pending OR a
     * result is visible" version passes against the broken build too, since the
     * result also arrives inside any reasonable timeout — it would have proved
     * nothing.
     */
    await expect(page.getByTestId('shipping-pending')).toBeVisible({ timeout: 2_000 });

    /*
     * Wait for the estimate to *resolve* before branching. `count()` does not
     * auto-wait, so checking it immediately after submit samples the gap between
     * the form collapsing and the action returning — the estimator renders
     * nothing at all in that window, which reads identically to "no options" and
     * silently skipped this test while the feature worked.
     */
    await expect(apply.or(noOptions).first()).toBeVisible({ timeout: 20_000 });

    // A store may genuinely not ship to the address; that is a pass, not a
    // failure, and is exactly what the 'none' state exists to say.
    if ((await noOptions.count()) > 0) {
      test.skip(true, 'store quotes no shipping options for this address');
    }

    const options = page.locator('input[name="shippingOption"]');

    await expect(options.first()).toBeVisible();

    // Pick the last option so the assertion cannot pass on the default.
    await options.last().check();
    await apply.click();

    await expect(page.getByText(/Shipping method applied|Método de envío aplicado/)).toBeVisible();
  });
});

/**
 * Server toasts.
 *
 * The whole mechanism was broken and silent: `getServerToast` deleted the cookie
 * during render, which Next forbids, and the `<Suspense fallback={null}>` around
 * `ToasterGate` swallowed the throw. No toast ever appeared, and nothing failed.
 * These two assertions are what would have caught it — that it shows, and that it
 * shows only once.
 */
test.describe('server toast', () => {
  const toast = (message: string) => ({
    name: 'cf.toast',
    value: encodeURIComponent(JSON.stringify({ variant: 'error', message })),
    domain: '127.0.0.1',
    path: '/',
  });

  test('a queued toast is shown on the next page', async ({ page, context }) => {
    await context.addCookies([toast('Checkout could not start')]);
    await page.goto('/cart/');

    // Not `getByRole('alert')`: Next's route announcer carries that role too.
    await expect(page.getByTestId('server-toast')).toContainText('Checkout could not start');
  });

  test('and is cleared, so it does not follow the shopper around', async ({ page, context }) => {
    await context.addCookies([toast('Checkout could not start')]);
    await page.goto('/cart/');
    await expect(page.getByTestId('server-toast')).toBeVisible();

    // Clearing happens in the browser — the server may not mutate cookies during
    // render — so the cookie must be gone by the time the next page loads.
    await page.goto('/cart/');
    await expect(page.getByTestId('server-toast')).toHaveCount(0);
  });
});
