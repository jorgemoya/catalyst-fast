'use client';

import { useEffect, useRef, useState } from 'react';

import type { WalletButtonOption } from '~/data/wallets';

/**
 * Express-checkout wallet buttons.
 *
 * **Loaded from BigCommerce's CDN at runtime, not installed as a dependency.**
 * `@bigcommerce/checkout-sdk` is not in `package.json` and deliberately so: the
 * wallet module has to match the version BigCommerce is serving on the checkout
 * side, and pinning it in our lockfile would let the two drift. Catalyst does the
 * same. The cost is an external script, which the CSP must allow.
 *
 * Everything below is DOM plumbing the SDK requires. It takes its options as a
 * prop — already resolved on the server — and never fetches: the payload is
 * single-use payment session material, so it must not be re-derived in the
 * browser. See `data/wallets.ts`.
 */

declare global {
  interface Window {
    checkoutKitLoader?: {
      load: (moduleName: string) => Promise<{
        createWalletButtonInitializer: (options: { graphQLEndpoint: string }) => {
          initializeWalletButton: (option: WalletButtonOption) => void;
        };
      }>;
    };
  }
}

const LOADER_URL =
  process.env.NEXT_PUBLIC_CHECKOUT_SDK_URL ?? 'https://checkout-sdk.bigcommerce.com/v1/loader.js';

/**
 * The proxy on our own origin — never BigCommerce directly.
 *
 * The SDK issues GraphQL from the browser, and reaching BigCommerce would mean
 * putting the storefront token in the page. `app/graphql/route.ts` forwards a
 * closed allow-list of operations instead. The trailing slash matters:
 * `trailingSlash: true` makes the unslashed form a 308, and the SDK's requests
 * would take an extra hop on every call.
 */
const GRAPHQL_ENDPOINT = '/graphql/';

async function loadCheckoutKit(): Promise<void> {
  if (window.checkoutKitLoader) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');

    script.type = 'text/javascript';
    script.defer = true;
    script.src = LOADER_URL;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('checkout-sdk loader failed'));

    document.body.append(script);
  });
}

export function WalletButtons({ options }: { options: WalletButtonOption[] }) {
  const initialized = useRef(false);

  /*
   * Wallet SDKs mount into their container via zoid iframes and do not survive
   * the node being reused. Bumping this key remounts the containers so each
   * initialization attaches to fresh DOM.
   */
  const [renderKey, setRenderKey] = useState(0);

  /*
   * Back/forward navigation restores the page from bfcache with the iframes
   * detached but the React tree intact, so nothing would re-initialize and the
   * shopper returns to an empty space where the buttons were.
   */
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        initialized.current = false;
        setRenderKey((key) => key + 1);
      }
    };

    window.addEventListener('pageshow', onPageShow);

    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  useEffect(() => {
    if (initialized.current || options.length === 0) {
      return;
    }

    initialized.current = true;

    const run = async () => {
      await loadCheckoutKit();

      const walletModule = await window.checkoutKitLoader?.load('wallet-button');
      const initializer = walletModule?.createWalletButtonInitializer({
        graphQLEndpoint: GRAPHQL_ENDPOINT,
      });

      for (const option of options) {
        initializer?.initializeWalletButton(option);
      }
    };

    /*
     * A wallet provider being unreachable must not take the cart page with it —
     * the ordinary checkout button sits right beside these and still works.
     */
    void run().catch((error: unknown) => {
      initialized.current = false;
      console.error('[wallet-buttons]', error);
    });
  }, [options, renderKey]);

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2" data-testid="wallet-buttons">
      {options.map((option) => (
        <div id={option.containerId} key={`${option.containerId}-${renderKey}`} />
      ))}
    </div>
  );
}
