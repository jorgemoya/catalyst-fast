import type { AnalyticsEvent } from '~/domain/analytics';

/**
 * A destination for analytics events.
 *
 * `enabled()` is a function rather than a boolean so configuration is read at
 * send time. Evaluating it at module scope would bake the answer in at import,
 * which breaks under the lazy env parsing in `lib/env.ts` — that Proxy exists
 * precisely so a build without secrets does not explode, and a provider reading
 * env eagerly would defeat it.
 */
export interface AnalyticsProvider {
  name: string;
  enabled: () => boolean;
  send: (events: AnalyticsEvent[]) => Promise<void>;
}
