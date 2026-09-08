import { Suspense, type ReactNode } from 'react';

import { Footer } from '~/ui/layout/footer';
import { Header } from '~/ui/layout/header';
import { CompareDrawerGate } from '~/ui/patterns/compare-gate';
import { ConsentGate } from '~/ui/patterns/consent-gate';

/**
 * Storefront chrome.
 *
 * A plain non-async function that reads nothing — every data-touching region
 * inside `Header`/`Footer` owns its own `<Suspense>` boundary. That keeps the
 * layout itself in the prerendered shell and means a slow read in the nav can
 * never delay the page body, which is the failure mode a layout-level `await`
 * would create for every route at once.
 *
 * `/maintenance` deliberately sits outside this group: the store being down is
 * exactly when the header's BigCommerce reads are least likely to succeed.
 */
export default function StorefrontLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="flex-1" id="main">
        {children}
      </main>
      <Footer />
      {/* Both read only cached store settings, never a cookie or a search param,
          so they stay in the shell. Each decides in the browser whether to
          appear — the consent banner from its cookie, the compare drawer from
          sessionStorage. */}
      <Suspense fallback={null}>
        <ConsentGate />
      </Suspense>
      <Suspense fallback={null}>
        <CompareDrawerGate />
      </Suspense>
    </div>
  );
}
