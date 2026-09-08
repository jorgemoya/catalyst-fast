'use client';

import { useSyncExternalStore } from 'react';

import type { MerchantScript, ScriptConsentCategory } from '~/data/scripts';
import {
  CONSENT_COOKIE_NAME,
  type Consent,
  type ConsentCategory,
  parseConsent,
} from '~/domain/consent';

/**
 * Injects merchant-configured third-party scripts, honouring cookie consent.
 *
 * **A client component because consent is a cookie.** Deciding server-side which
 * scripts may load would make the root layout dynamic for every visitor —
 * exactly the trade the consent banner already refuses. The scripts and their
 * categories arrive as props from a cached read; only the *filtering* happens
 * here.
 *
 * The consequence is that scripts load after hydration rather than in the
 * initial HTML. That is slower for the merchant's analytics and is the correct
 * trade: a storefront that gives up its static shell so a chat widget can load
 * 200ms sooner has the priorities backwards. Merchants who need a script in the
 * initial HTML should use `ESSENTIAL`, which needs no consent — though it still
 * renders client-side here.
 */

/** BigCommerce's script categories → the four categories the banner collects. */
const CATEGORY_MAP: Record<ScriptConsentCategory, ConsentCategory | 'necessary'> = {
  ESSENTIAL: 'necessary',
  FUNCTIONAL: 'functionality',
  ANALYTICS: 'measurement',
  TARGETING: 'marketing',
  /*
   * `UNKNOWN` is treated as marketing — the most restrictive category — rather
   * than as essential. A script whose purpose BigCommerce cannot classify is
   * precisely the one that should not run without explicit consent, and
   * defaulting the other way would leak an unclassified tracker to shoppers who
   * declined everything.
   */
  UNKNOWN: 'marketing',
};

function readConsent(): string {
  return (
    document.cookie
      .split('; ')
      .find((row) => row.startsWith(`${CONSENT_COOKIE_NAME}=`))
      ?.slice(CONSENT_COOKIE_NAME.length + 1) ?? ''
  );
}

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('cf:consent', onChange);

  return () => window.removeEventListener('cf:consent', onChange);
};

const getServerSnapshot = (): string => '';

function isAllowed(
  script: MerchantScript,
  consent: Consent | null,
  consentEnabled: boolean,
): boolean {
  const required = CATEGORY_MAP[script.consentCategory];

  // Essential scripts are what makes the store work; they need no permission.
  if (required === 'necessary') {
    return true;
  }

  if (!consentEnabled) {
    return true;
  }

  return consent?.[required] ?? false;
}

export function MerchantScripts({
  scripts,
  consentEnabled,
}: {
  scripts: MerchantScript[];
  consentEnabled: boolean;
}) {
  const raw = useSyncExternalStore(subscribe, readConsent, getServerSnapshot);
  const consent = parseConsent(raw ? decodeURIComponent(raw) : undefined);

  const allowed = scripts.filter((script) => isAllowed(script, consent, consentEnabled));

  return (
    <>
      {allowed.map((script) =>
        script.kind === 'src' ? (
          <script async key={script.id} src={script.src} />
        ) : (
          /*
           * `scriptTag` is a full `<script>…</script>` string from the control
           * panel, so it cannot be rendered as a child — React would escape it
           * into visible text. `dangerouslySetInnerHTML` on a wrapper is the
           * only way to inject it.
           *
           * This is merchant-authored content from an authenticated admin,
           * which is the same trust level as the theme itself — but it is
           * genuinely arbitrary script execution, so it is worth being explicit:
           * a compromised BigCommerce admin account can run code on this
           * storefront. That is true of any storefront honouring these settings,
           * including BigCommerce's own.
           */
          <span
            dangerouslySetInnerHTML={{ __html: script.scriptTag }}
            key={script.id}
            style={{ display: 'none' }}
          />
        ),
      )}
    </>
  );
}
