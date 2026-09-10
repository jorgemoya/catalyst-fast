import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

/**
 * reCAPTCHA configuration, **from BigCommerce rather than from env**.
 *
 * The merchant enables reCAPTCHA in the BigCommerce control panel and BigCommerce
 * holds the secret. It follows that the storefront should read the site key from
 * the same place and let BigCommerce do the verifying — which is what Catalyst
 * does, and what this replaces an env-var implementation with.
 *
 * The env-based version was wrong in three ways at once, and they compounded:
 *
 *  1. It required `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`, so a merchant who switched
 *     reCAPTCHA on in the control panel got nothing until someone edited the
 *     environment and redeployed. The setting silently did not apply.
 *  2. It called Google's `siteverify` with a `RECAPTCHA_SECRET_KEY` that
 *     duplicated the secret BigCommerce already held — two places to configure,
 *     two places to get out of step.
 *  3. It implemented **v3** (invisible, score-based) while BigCommerce's API is
 *     **v2** (`ReCaptchaV2Input`, `g-recaptcha-response`). A v3 token would not
 *     have validated against a v2 configuration even if it had been forwarded.
 *
 * `isEnabledOnStorefront` is the merchant's own switch and is honoured
 * separately from the key existing: a store can have a key configured and
 * reCAPTCHA turned off.
 */

const RecaptchaSettingsQuery = graphql(`
  query RecaptchaSettings {
    site {
      settings {
        reCaptcha {
          siteKey
          isEnabledOnStorefront
        }
      }
    }
  }
`);

export interface RecaptchaSettings {
  siteKey: string;
}

/**
 * The site key when reCAPTCHA is on, `null` otherwise.
 *
 * Returning `null` rather than a disabled flag keeps every call site honest:
 * there is no way to render the widget without having proven it should exist.
 */
export async function getRecaptchaSettings(): Promise<RecaptchaSettings | null> {
  'use cache';
  cacheLife('settings');
  cacheTag(tags.settings);

  const data = await query({ document: RecaptchaSettingsQuery });
  const settings = data.site.settings?.reCaptcha;

  if (!settings?.isEnabledOnStorefront || !settings.siteKey) {
    return null;
  }

  return { siteKey: settings.siteKey };
}
