'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';

/**
 * reCAPTCHA v3 hidden field.
 *
 * v3 has no visible challenge — it scores the session in the background and the
 * form submits a token. So this renders a hidden input rather than a widget, and
 * the only visible obligation is Google's required attribution notice, which the
 * consuming form is responsible for placing.
 *
 * Renders nothing at all when no site key is configured, which keeps every form
 * that uses it working on an install that never set reCAPTCHA up.
 */
declare global {
  interface Window {
    grecaptcha?: {
      ready: (callback: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}

const SITE_KEY = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;

export function RecaptchaField({ action, name = 'recaptchaToken' }: { action: string; name?: string }) {
  const [token, setToken] = useState('');

  useEffect(() => {
    if (!SITE_KEY) {
      return;
    }

    let cancelled = false;

    /*
     * v3 tokens expire after two minutes. Minting one on mount and leaving it
     * there means any form a shopper spends real time on — writing a review, for
     * instance, which is the main consumer here — submits an expired token and
     * fails verification. So it refreshes on an interval comfortably inside the
     * expiry window.
     */
    const mint = (): void => {
      window.grecaptcha?.ready(() => {
        window.grecaptcha
          ?.execute(SITE_KEY, { action })
          .then((value) => {
            if (!cancelled) {
              setToken(value);
            }
          })
          .catch(() => {
            // Leave the token empty; the server decides what to do about it.
          });
      });
    };

    mint();

    const interval = setInterval(mint, 90_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [action]);

  if (!SITE_KEY) {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.google.com/recaptcha/api.js?render=${SITE_KEY}`}
        strategy="lazyOnload"
      />
      <input name={name} type="hidden" value={token} />
    </>
  );
}
