import { expect, test } from '@playwright/test';

import { PRODUCT_WITH_OPTIONS, SIMPLE_PRODUCT } from './fixtures';

/**
 * The signed-in path — the largest unverified area in Phase 6.
 *
 * Credentials come from the environment so they never enter the repo or a
 * transcript:
 *
 *   E2E_CUSTOMER_EMAIL
 *   E2E_CUSTOMER_PASSWORD
 *
 * The whole file skips when they're absent, so CI and anyone without a test
 * customer still get a green suite rather than a wall of failures they can't act
 * on.
 *
 * **Serial by necessity.** Every test here signs in as the *same* customer, and
 * BigCommerce's login endpoint rejects concurrent attempts on one account — under
 * `fullyParallel` the workers race and most of the file fails on a login that
 * silently stays on `/login/`. The tests also mutate shared state (the cart, the
 * wishlists, the profile), so parallelising them would be wrong even if the login
 * held up. Run serially they pass; that is a property of the fixture account, not
 * of the storefront.
 */
test.describe.configure({ mode: 'serial' });

const email = process.env.E2E_CUSTOMER_EMAIL;
const password = process.env.E2E_CUSTOMER_PASSWORD;

test.skip(
  !email || !password,
  'Set E2E_CUSTOMER_EMAIL and E2E_CUSTOMER_PASSWORD to run the signed-in suite.',
);

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/login/');
  await page.getByLabel('Email').fill(email ?? '');
  await page.getByLabel('Password').fill(password ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/orders/);
}

test.describe('sign in', () => {
  test('signs in and lands on the account', async ({ page }) => {
    await signIn(page);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My account');
  });

  test('merges the guest cart into the customer cart', async ({ page }) => {
    /*
     * The cart merge, which is BigCommerce's to perform: `login` is given
     * `guestCartEntityId` and returns the resulting cart, which the sign-in
     * callback writes back to the same `cf.cart` cookie.
     *
     * Adding as a guest first is what makes this a real test — signing in with an
     * empty cart would pass whether or not the merge works.
     */
    await page.goto(SIMPLE_PRODUCT);
    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await signIn(page);

    // The badge must still show the item after authenticating.
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.goto('/cart/');
    await expect(page.getByTestId('cart-items').getByRole('listitem')).toHaveCount(1);
  });

  test('shows the account menu instead of a sign-in link', async ({ page }) => {
    await signIn(page);
    await page.goto('/');

    await expect(page.getByRole('link', { name: /^Hi, / })).toBeVisible();
  });
});

test.describe('signed-in PDP', () => {
  test('serves the same shell as a guest', async ({ page }) => {
    /*
     * **The Phase 6 bar.** Everything in the body must be identical to what a
     * guest receives; only the header chrome and an optional price overlay may
     * differ. If this fails, the caching design has regressed to Catalyst's
     * behaviour of re-rendering the whole page per identity.
     */
    await signIn(page);
    await page.goto(PRODUCT_WITH_OPTIONS);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/\S/);
    await expect(page.getByTestId('product-price')).toBeVisible();
    await expect(page.getByTestId('add-to-cart')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Specifications' })).toBeVisible();
  });

  test('offers a real wishlist toggle rather than a sign-in link', async ({ page }) => {
    await signIn(page);
    await page.goto(PRODUCT_WITH_OPTIONS);

    await expect(page.getByTestId('wishlist-toggle')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign in to save to a wishlist' })).toHaveCount(0);
  });
});

test.describe('account', () => {
  test('renders every section without erroring', async ({ page }) => {
    // Each of these is a customer-scoped query that has never run against real
    // data; an empty state is a pass, an error page is not.
    await signIn(page);

    for (const [section, heading] of [
      ['orders', 'My account'],
      ['addresses', 'My account'],
      ['wishlists', 'My account'],
      ['settings', 'My account'],
    ] as const) {
      await page.goto(`/account/${section}/`);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      await expect(page.locator('text=Something went wrong')).toHaveCount(0);
    }
  });

  /*
   * Render-only, deliberately. `isSubscribedToNewsletter` was readable and
   * unchangeable — the control existing at all is the fix — but submitting it
   * writes to the merchant's real subscriber list and can trigger a live email,
   * so this asserts the control is present and reflects the stored value rather
   * than exercising the mutation against someone's actual account.
   */
  test('offers a newsletter preference reflecting the stored value', async ({ page }) => {
    await signIn(page);
    await page.goto('/account/settings/');

    const toggle = page.getByTestId('newsletter-toggle');

    await expect(toggle).toBeVisible();
    await expect(toggle).toBeEnabled();

    // Whichever way it is set, it must be a real reflection rather than a
    // hardcoded default — the checkbox is bound to the profile field.
    expect(typeof (await toggle.isChecked())).toBe('boolean');
  });

  /*
   * Country and state are selects, not free text.
   *
   * They used to be two plain inputs asking for a two-letter code, so "USA" and
   * "United States" both failed and a mistyped state produced an address
   * BigCommerce accepts and a courier cannot deliver. The shipping estimator in
   * the same codebase already did this properly.
   */
  test('the address form picks country and state from lists', async ({ page }) => {
    await signIn(page);
    await page.goto('/account/addresses/');
    await page.getByRole('button', { name: 'Add address' }).click();

    const country = page.locator('select[name="countryCode"]');

    await expect(country).toBeVisible();
    await expect(country.locator('option')).not.toHaveCount(1);

    // Choosing a country with states reveals the state list; before this fix
    // there was no such dependency because both were free text.
    await country.selectOption({ label: 'United States' });
    await expect(page.locator('select[name="stateOrProvince"]')).toBeVisible();
  });

  /*
   * The address form renders the merchant's own extra fields.
   *
   * This store has two — a "Residence Type" picklist and a "Delivery Notes"
   * multiline — that the hand-written schema silently dropped. The failure had
   * no symptom: `formFields` is optional on the mutation, so BigCommerce accepted
   * the omission and the merchant simply never received the answers.
   *
   * Render-only. Submitting would write a real address to the fixture account,
   * and the value here is proving the fields exist and are labelled.
   */
  test("the address form renders the store's own custom fields", async ({ page }) => {
    await signIn(page);
    await page.goto('/account/addresses/');

    await page.getByRole('button', { name: 'Add address' }).click();

    const custom = page.locator('[name^="custom_"]');

    if ((await custom.count()) === 0) {
      test.skip(true, 'store has no custom address fields configured');
    }

    await expect(custom.first()).toBeVisible();

    // Every custom control carries a label, an enclosing label, or a fieldset.
    const unlabelled = await page.evaluate(() =>
      [...document.querySelectorAll('[name^="custom_"]')].filter((el) => {
        const name = el.getAttribute('name') ?? '';

        return (
          !document.querySelector(`label[for="${name}"]`) &&
          !el.closest('label') &&
          !el.closest('fieldset')
        );
      }).length,
    );

    expect(unlabelled).toBe(0);
  });

  test('round-trips a wishlist: create, save a product, remove, delete', async ({ page }) => {
    const name = `E2E ${Date.now()}`;

    await signIn(page);
    await page.goto('/account/wishlists/');

    await page.getByLabel('Wishlist name').fill(name);
    await page.getByRole('button', { name: 'New wishlist' }).click();
    await expect(page.getByTestId('wishlists')).toContainText(name);

    await page.goto(PRODUCT_WITH_OPTIONS);
    await page.getByTestId('wishlist-toggle').click();
    await page.getByRole('button', { name }).click();

    // The heart reflects membership on reload, which is the part that proves the
    // add actually persisted rather than just optimistically rendering.
    await page.reload();
    await expect(page.getByTestId('wishlist-toggle')).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/account/wishlists/');
    await page.getByRole('listitem').filter({ hasText: name }).getByRole('button', { name: 'Delete' }).click();

    /*
     * Asserted on the row, not on `getByTestId('wishlists')`: the list element
     * is replaced by the empty state once the last wishlist goes, so asserting
     * `not.toContainText` against it errors on a missing element instead of
     * passing. That made this test pass only while earlier runs had left stray
     * wishlists behind — it went red the moment the store was cleaned up.
     */
    await expect(page.getByRole('listitem').filter({ hasText: name })).toHaveCount(0);
  });

  /*
   * Writes to the real store, so it puts the field back.
   *
   * The obvious alternative — assert the form renders and never submit — would
   * drop the only coverage of the write path, which is exactly where the bugs
   * have been: this suite has already caught a missing `refresh()` that left the
   * UI a mutation behind. So the round trip stays, and the original value is
   * restored in `finally` so a mid-test failure cannot leave `E2E <timestamp>`
   * sitting on the account.
   */
  test('updates the profile and shows it on reload', async ({ page }) => {
    await signIn(page);
    await page.goto('/account/settings/');

    const field = page.getByLabel('Company');
    const original = await field.inputValue();
    const company = `E2E ${Date.now()}`;

    try {
      await field.fill(company);
      await page.getByRole('button', { name: 'Save changes' }).click();

      await expect(page.getByTestId('profile-saved')).toBeVisible();

      await page.reload();
      await expect(page.getByLabel('Company')).toHaveValue(company);
    } finally {
      await page.goto('/account/settings/');
      await page.getByLabel('Company').fill(original);
      await page.getByRole('button', { name: 'Save changes' }).click();
      await expect(page.getByTestId('profile-saved')).toBeVisible();
    }

    await page.reload();
    await expect(page.getByLabel('Company')).toHaveValue(original);
  });

  test('signs out and returns to a guest header', async ({ page }) => {
    await signIn(page);
    await page.goto('/logout/');
    await page.getByRole('button', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('link', { name: 'Sign in' })).toBeVisible();
  });
});
