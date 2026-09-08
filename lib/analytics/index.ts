import 'server-only';

import type { AnalyticsEvent } from '~/domain/analytics';

import { bigcommerceProvider } from './providers/bigcommerce';
import { googleAnalyticsProvider } from './providers/google-analytics';
import type { AnalyticsProvider } from './types';

/**
 * Provider fan-out.
 *
 * Every provider is optional and self-disabling: a provider whose credentials
 * are absent reports `enabled: false` and is skipped. That is what lets this
 * ship configured for nothing at all, which is the correct default for a
 * template.
 */

const providers: AnalyticsProvider[] = [bigcommerceProvider, googleAnalyticsProvider];

/**
 * Sends events to every configured provider.
 *
 * **Never throws, never rejects.** Analytics is not allowed to affect the
 * storefront: a provider outage, a DNS failure, or a malformed response must not
 * surface anywhere near a shopper, and this is called without `await` from a
 * beacon whose response nobody reads. An unhandled rejection there would become
 * a process-level warning (or, in some runtimes, a crash) caused entirely by a
 * third party being down.
 *
 * Providers run concurrently and independently — one failing does not prevent
 * the others from receiving the event.
 */
export async function dispatch(events: AnalyticsEvent[]): Promise<void> {
  const active = providers.filter((provider) => provider.enabled());

  if (active.length === 0) {
    return;
  }

  await Promise.allSettled(
    active.map(async (provider) => {
      try {
        await provider.send(events);
      } catch (error) {
        // Logged, not rethrown. The provider name is safe to log; the events
        // are not necessarily, so they are omitted.
        console.error(`[analytics] ${provider.name} failed`, error);
      }
    }),
  );
}
