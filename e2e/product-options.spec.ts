import { expect, test } from '@playwright/test';

import { PRODUCT_WITH_OPTIONS } from './fixtures';

/**
 * The full option matrix, on the one product that exercises ten of BigCommerce's
 * eleven option types: swatch, rectangle boxes, dropdown, radio buttons,
 * checkbox, product pick list with images, text, multi-line text, number, and
 * date. (Only the image-less pick list is absent, and it shares a branch with the
 * one that isn't.)
 *
 * Until this store was connected, ten of those branches had only ever run against
 * fixtures.
 */

/** Fills every non-variant control with a value that passes validation. */
async function fillPersonalization(page: import('@playwright/test').Page) {
  await page.locator('textarea[name^="option."]').fill('Happy birthday Ana!');
  await page.locator('input[type="text"][name^="option."]').fill('Gift');
  await page.locator('input[type="number"][name^="option."]').fill('3');
  await page.locator('input[type="date"][name^="option."]').fill('2026-12-24');
}

/** Answers every required variant option, whatever control it renders as. */
async function chooseRequiredOptions(page: import('@playwright/test').Page) {
  for (const group of await page.locator('fieldset').all()) {
    const unset = group.locator('button[aria-pressed="false"]').first();

    if (await unset.count()) {
      await unset.click();
    }
  }

  for (const select of await page.locator('select[name^="option."]').all()) {
    const values = await select
      .locator('option')
      .evaluateAll((options) =>
        options.map((option) => (option as HTMLOptionElement).value).filter(Boolean),
      );

    if (values[0]) {
      await select.selectOption(values[0]);
    }
  }
}

test.describe('product options', () => {
  test('renders a control for every option type', async ({ page }) => {
    await page.goto(PRODUCT_WITH_OPTIONS);

    // Swatches and boxes and radios are all buttons in fieldsets; the rest are
    // distinct element types.
    await expect(page.locator('fieldset')).toHaveCount(4);
    await expect(page.locator('select[name^="option."]')).toHaveCount(1);
    await expect(page.locator('textarea[name^="option."]')).toHaveCount(1);
    await expect(page.locator('input[type="text"][name^="option."]')).toHaveCount(1);
    await expect(page.locator('input[type="number"][name^="option."]')).toHaveCount(1);
    await expect(page.locator('input[type="date"][name^="option."]')).toHaveCount(1);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(1);
  });

  test('derives native constraints from the catalog, including which bound applies', async ({
    page,
  }) => {
    await page.goto(PRODUCT_WITH_OPTIONS);

    await expect(page.locator('textarea[name^="option."]')).toHaveAttribute('minlength', '10');
    await expect(page.locator('textarea[name^="option."]')).toHaveAttribute('maxlength', '50');
    await expect(page.locator('input[type="text"][name^="option."]')).toHaveAttribute(
      'minlength',
      '2',
    );

    /*
     * The number option sets `lowest: 0` *and* `limitNumberBy: HIGHEST_VALUE`.
     * Only the upper bound applies — BigCommerce uses `limitNumberBy` to say which
     * of the two stored values is meaningful, so rendering `min` here would invent
     * a rule the merchant didn't set.
     */
    const number = page.locator('input[type="number"][name^="option."]');

    await expect(number).toHaveAttribute('max', '5');
    await expect(number).not.toHaveAttribute('min', /.*/);
  });

  test('defaults the checkbox from checkedByDefault', async ({ page }) => {
    // "Unchecked" is its own option-value id rather than an absence, so the
    // hidden input must carry a value even before the shopper touches it.
    await page.goto(PRODUCT_WITH_OPTIONS);

    await expect(page.locator('input[type="checkbox"]')).toBeChecked();
    await expect(page.locator('input[type="hidden"][name^="option."]').nth(3)).toHaveValue(/\d+/);
  });

  test('gates the CTA on every required option, naming what is missing', async ({ page }) => {
    await page.goto(PRODUCT_WITH_OPTIONS);

    const cta = page.getByTestId('add-to-cart');

    // Four required options, none with a default.
    await expect(cta).toBeDisabled();
    await expect(cta).toHaveText('Select Color and Size and Dropdown and Radio');

    await chooseRequiredOptions(page);

    await expect(cta).toBeEnabled();
    await expect(cta).toHaveText('Add to cart');
  });

  test('resolves a concrete price once a variant is identified', async ({ page }) => {
    await page.goto(PRODUCT_WITH_OPTIONS);

    // Starts as a range across variants.
    await expect(page.getByTestId('product-price')).toContainText('–');

    await chooseRequiredOptions(page);

    await expect(page.getByTestId('product-price')).not.toContainText('–');
  });

  test('server-side validation reports per-field errors when native checks are bypassed', async ({
    page,
  }) => {
    /*
     * The browser blocks these first, so this path is only reachable by a crafted
     * POST — which is exactly why it must work. Disabling `noValidate` simulates
     * that without leaving the page.
     */
    await page.goto(PRODUCT_WITH_OPTIONS);
    await chooseRequiredOptions(page);

    await page.locator('textarea[name^="option."]').fill('short');
    await page.locator('input[type="text"][name^="option."]').fill('x');
    await page.locator('input[type="number"][name^="option."]').fill('9');

    await page.locator('form').evaluate((form) => {
      (form as HTMLFormElement).noValidate = true;
    });
    await page.getByTestId('add-to-cart').click();

    const errors = page.locator('form p.text-error');

    await expect(errors).toHaveCount(3);
    await expect(errors.nth(0)).toHaveText('Must be at least 10 characters.');
    await expect(errors.nth(1)).toHaveText('Must be at least 2 characters.');
    await expect(errors.nth(2)).toHaveText('Must be 5 or fewer.');

    // Nothing was added.
    await expect(page.getByTestId('add-to-cart-success')).toHaveCount(0);
    await expect(page.getByTestId('cart-count')).toHaveCount(0);
  });

  test('carries every option through to the cart line', async ({ page }) => {
    await page.goto(PRODUCT_WITH_OPTIONS);

    await chooseRequiredOptions(page);
    await fillPersonalization(page);
    await page.getByRole('button', { name: /Able Brewing System/ }).click();

    await page.getByTestId('add-to-cart').click();
    await expect(page.getByTestId('cart-count')).toHaveText('1');

    await page.goto('/cart/');

    const options = page.getByTestId('cart-items').locator('dl');

    await expect(options).toContainText('Custom Message');
    await expect(options).toContainText('Happy birthday Ana!');
    await expect(options).toContainText('Gift');
    await expect(options).toContainText('Pick List');

    /*
     * The date is the interesting one. A picked calendar date is anchored at UTC
     * midnight on submission, so it has to be *read back* in UTC — formatting it
     * in the viewer's timezone shifted it a day for everyone west of UTC.
     * Observed live: 2026-12-24 rendered as "Dec 23, 2026" in America/Chicago.
     */
    await expect(options).toContainText('Dec 24, 2026');
  });
});
