'use client';

import { useTranslations } from 'next-intl';
import Script from 'next/script';
import { useEffect, useRef, useState } from 'react';

/**
 * reCAPTCHA v2 widget.
 *
 * **v2, not v3, because that is what BigCommerce implements.** Its API takes
 * `ReCaptchaV2Input` and the token field is `g-recaptcha-response`; a v3 token
 * would not validate against it. The previous version here was v3 — invisible
 * and score-based — which looked more elegant and could never have worked.
 *
 * The site key is a **prop**, resolved server-side from
 * `site.settings.reCaptcha`, so the merchant's control-panel setting is the only
 * place reCAPTCHA is configured. There is deliberately no env var: the earlier
 * implementation needed one, which meant switching reCAPTCHA on in BigCommerce
 * did nothing until someone also edited the environment and redeployed.
 *
 * Renders nothing when `siteKey` is absent, so a store with reCAPTCHA off is
 * unaffected — and the required attribution notice lives inside that guard, so
 * it can never claim protection the store does not have.
 */
export function RecaptchaField({ siteKey }: { siteKey: string | null }) {
  const t = useTranslations();
  const container = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!siteKey || !ready || !container.current) {
      return;
    }

    /*
     * Explicit render rather than the `g-recaptcha` auto-render class: the
     * widget mounts inside a React tree that may re-render, and auto-render
     * would attach a second widget to the same node on the next pass. The
     * `data-rendered` marker makes that idempotent.
     */
    if (container.current.dataset.rendered === 'true') {
      return;
    }

    window.grecaptcha?.ready(() => {
      if (container.current && container.current.dataset.rendered !== 'true') {
        container.current.dataset.rendered = 'true';
        window.grecaptcha?.render(container.current, { sitekey: siteKey });
      }
    });
  }, [siteKey, ready]);

  if (!siteKey) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      <Script
        onReady={() => setReady(true)}
        src="https://www.google.com/recaptcha/api.js?render=explicit"
        strategy="lazyOnload"
      />

      {/*
        The widget writes the token into a `g-recaptcha-response` textarea it
        creates itself, which is what the form submits — so there is no hidden
        input of ours to keep in sync.
      */}
      <div ref={container} />

      {/*
        Google requires attribution wherever the badge is hidden. It lives here
        rather than in each form because the previous contract — "the consuming
        form is responsible for placing it" — was forgotten by two of the three
        forms within an hour of being written.
      */}
      <p className="text-xs text-muted">{t('Common.recaptchaNotice')}</p>
    </div>
  );
}

declare global {
  interface Window {
    grecaptcha?: {
      ready: (callback: () => void) => void;
      render: (container: HTMLElement, options: { sitekey: string }) => number;
    };
  }
}
