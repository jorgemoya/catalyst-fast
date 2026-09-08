import { SpanStatusCode, type Span, trace } from '@opentelemetry/api';

/**
 * Telemetry for the one number this project exists to move: **origin requests
 * per storefront pageview**.
 *
 * Up to now that number has only ever been produced by hand — start a server
 * with `CLIENT_LOGGER=true`, drive it with a script, grep the log, subtract.
 * That works for a one-off measurement and is useless as a regression signal,
 * which means the central claim of the architecture is unfalsifiable in
 * production. This makes it a metric.
 *
 * **Only `@opentelemetry/api` is imported, never an SDK.** The API is a no-op
 * shim until something calls `trace.setGlobalTracerProvider`, so with no
 * collector configured this costs approximately nothing and pulls in no vendor.
 * Wiring an exporter is a deployment decision, made in `instrumentation.ts`,
 * not a dependency baked into the app.
 */

const tracer = trace.getTracer('catalyst-fast');

/** Attribute names, centralised so dashboards and alerts key off constants. */
export const attr = {
  /** GraphQL operation name, e.g. `ProductPage`. The primary grouping. */
  queryName: 'bc.query.name',
  /** BigCommerce's own complexity budget, from `x-bc-graphql-complexity`. */
  complexity: 'bc.graphql.complexity',
  /** Which retry produced the response; 0 means first try. */
  attempt: 'bc.retry.attempt',
  status: 'http.status_code',
  /** Set on cached-function spans. See `recordCacheMiss`. */
  cacheHit: 'cache.hit',
  cacheFunction: 'cache.function',
  cacheKeyShape: 'cache.key_shape',
} as const;

/**
 * Wraps one outbound BigCommerce request in a span.
 *
 * Every span here is by definition a **cache miss** — a cached function that
 * hits never runs its body, so it never reaches the client. That is the
 * property that makes the KPI computable: cache hit rate is
 * `1 - (spans with bc.query.name) / (storefront request spans)`, both of which
 * Next's own instrumentation and this function emit.
 */
export async function traceQuery<T>(
  operationName: string,
  run: (span: Span) => Promise<T>,
): Promise<T> {
  return tracer.startActiveSpan(`bc.query ${operationName}`, async (span) => {
    span.setAttribute(attr.queryName, operationName);

    try {
      return await run(span);
    } catch (error) {
      // Recorded rather than swallowed: a query that throws is still a query
      // that cost the origin something, and it is the interesting case.
      span.recordException(error instanceof Error ? error : new Error(String(error)));
      span.setStatus({ code: SpanStatusCode.ERROR });

      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Records that a cached function had to compute — i.e. missed.
 *
 * `use cache` exposes no hit/miss signal of its own, and there is no way to ask
 * it after the fact. The only reliable observation point is *inside* the cached
 * body, which by construction executes only on a miss. Hits are therefore never
 * observed directly; they are inferred from their absence, which is why
 * `keyShape` matters — a miss rate is meaningless without knowing which key
 * shape produced it.
 *
 * `keyShape` must be a **shape, not a key**: `category+sort`, never
 * `category:12+sort:newest`. Cardinality is the whole point (a per-key metric
 * would be as unbounded as the search params it came from), and cache keys can
 * carry cart and customer ids, which must not reach a metrics backend.
 */
export function recordCacheMiss(fn: string, keyShape: string): void {
  const span = trace.getActiveSpan();

  if (!span) {
    return;
  }

  span.addEvent('cache.miss', {
    [attr.cacheFunction]: fn,
    [attr.cacheKeyShape]: keyShape,
    [attr.cacheHit]: false,
  });
}
