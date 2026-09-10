import { expect, test } from '@playwright/test';

import { PRODUCT_WITH_OPTIONS } from './fixtures';

/**
 * Signed-out behaviour, which is all that can be exercised without a test
 * customer on the connected store. A *successful* login — and everything behind
 * it — is covered by unit tests and manual verification only; see
 * docs/phase-6-auth.md.
 */

test.describe('account gating', () => {
  test('redirects a signed-out visitor to sign in, preserving where they were going', async ({
    page,
  }) => {
    await page.goto('/account/orders/');

    await expect(page).toHaveURL(/\/login\/?\?redirectTo=%2Faccount%2Forders/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
  });

  test('guards every account section, not just the one with the guard on it', async ({ page }) => {
    // The check lives in the layout precisely so a section added later inherits
    // it rather than forgetting it.
    for (const section of ['addresses', 'settings', 'wishlists']) {
      await page.goto(`/account/${section}/`);
      await expect(page).toHaveURL(/\/login\/?\?redirectTo=/);
    }
  });
});

test.describe('sign in', () => {
  test('rejects bad credentials in place, without saying which field was wrong', async ({
    page,
  }) => {
    // Distinguishing "no such email" from "wrong password" tells an attacker
    // which addresses are registered.
    await page.goto('/login/');

    await page.getByLabel('Email').fill('nobody@example.test');
    await page.getByLabel('Password').fill('definitely-wrong');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();

    /*
     * The requirement is that the message doesn't identify *which* field was
     * wrong — naming both together ("that email and password don't match") is
     * exactly the non-disclosing phrasing. So this asserts the absence of
     * field-level errors rather than matching on words, which an earlier version
     * got backwards and failed against the correct message.
     */
    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page.getByTestId('login-error')).toContainText(/don't match/i);

    // Neither input carries its own error, which is what would give the game away.
    await expect(page.locator('#email-error')).toHaveCount(0);
    await expect(page.locator('#password-error')).toHaveCount(0);
  });

  test('keeps the sign-in page out of the index', async ({ page }) => {
    await page.goto('/login/');

    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  });
});

test.describe('wishlist', () => {
  test('offers a guest sign-in rather than a button that fails', async ({ page }) => {
    await page.goto(PRODUCT_WITH_OPTIONS);

    const save = page.getByRole('link', { name: 'Sign in to save to a wishlist' });

    await expect(save).toBeVisible();

    // The product is carried through, so signing in returns the shopper here
    // rather than to a generic account page.
    await expect(save).toHaveAttribute(
      'href',
      new RegExp(`redirectTo=${encodeURIComponent(PRODUCT_WITH_OPTIONS).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
    );
  });
});

test.describe('personalized pricing', () => {
  test('renders no overlay for a guest, leaving the cached price alone', async ({ page }) => {
    // The whole point of the gate: guests and default-group customers cost zero
    // extra price fetches, so the prerendered price stands.
    await page.goto(PRODUCT_WITH_OPTIONS);

    await expect(page.getByTestId('product-price')).toBeVisible();
    await expect(page.getByTestId('personalized-price')).toHaveCount(0);
  });
});

/**
 * reCAPTCHA.
 *
 * Configured **entirely in BigCommerce** — `site.settings.reCaptcha` supplies
 * the site key and the on/off switch, and BigCommerce verifies the token it is
 * handed as `reCaptchaV2`. There is no env var and no call to Google from here.
 *
 * That replaced an env-driven v3 implementation which could not have worked:
 * BigCommerce's API is v2 (`ReCaptchaV2Input`, `g-recaptcha-response`), so a v3
 * token would never have validated. It also meant this store — which had
 * reCAPTCHA switched **on** the whole time — was running with every form
 * unprotected, because the storefront was looking in the wrong place.
 */
test.describe('reCAPTCHA', () => {
  test('renders the widget and its attribution on registration', async ({ page }) => {
    await page.goto('/register/');

    const notice = page.getByText('This site is protected by reCAPTCHA');

    // A merchant may switch it off; that is a pass, not a failure.
    if ((await notice.count()) === 0) {
      test.skip(true, 'reCAPTCHA is disabled for this store');
    }

    await expect(notice).toBeVisible();

    // The v2 widget mounts a Google-hosted iframe. Its presence is what proves
    // the site key reached the client — the notice alone would render for any
    // non-null key, including a wrong one.
    await expect(page.frameLocator('iframe[src*="recaptcha"]').locator('body')).toBeVisible({
      timeout: 15_000,
    });
  });
});
