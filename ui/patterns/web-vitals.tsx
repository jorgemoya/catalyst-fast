import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';

import { env } from '~/lib/env';

/**
 * Vercel Analytics and Speed Insights.
 *
 * **Gated on `VERCEL`**, matching how `createKVAdapter` picks its backing store.
 * Both packages are no-ops off-platform, but rendering them anyway would still
 * ship their scripts to every visitor of a self-hosted store to accomplish
 * nothing — and this project's whole argument is about not paying for things
 * that do not pay back.
 *
 * Kept separate from `lib/analytics/*`, which is the merchant's commerce
 * reporting fanned out server-side. This is field data about the storefront's
 * own performance — the numbers that tell you whether the caching work in
 * `docs/measuring.md` actually reached real devices, as opposed to a local
 * measurement on a fast laptop.
 */
export function WebVitals() {
  if (env.VERCEL !== '1') {
    return null;
  }

  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
