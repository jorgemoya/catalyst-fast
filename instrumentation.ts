/**
 * OpenTelemetry entry point. Next calls `register()` once per server process,
 * before any request is handled.
 *
 * **This file deliberately registers no exporter.** The app depends only on
 * `@opentelemetry/api`, which is an inert shim until a provider is installed, so
 * spans cost nothing and no vendor is baked in. Choosing a backend is a
 * deployment decision, and hard-coding one here would force it on every
 * self-hosted install.
 *
 * To turn telemetry on, install an SDK and register it below. On Vercel:
 *
 *   pnpm add @vercel/otel
 *
 *   export async function register() {
 *     const { registerOTel } = await import('@vercel/otel');
 *     registerOTel({ serviceName: 'catalyst-fast' });
 *   }
 *
 * Anywhere else, the vendor-neutral OTLP path:
 *
 *   pnpm add @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
 *
 *   export async function register() {
 *     if (process.env.NEXT_RUNTIME !== 'nodejs') return;
 *     const { NodeSDK } = await import('@opentelemetry/sdk-node');
 *     const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
 *     new NodeSDK({ traceExporter: new OTLPTraceExporter() }).start();
 *   }
 *
 * The `NEXT_RUNTIME` guard matters: this module also loads in the edge runtime,
 * where the Node SDK will not run.
 *
 * What to build once spans are flowing — the KPI this project is judged on:
 *
 *   origin requests per pageview
 *     = count(spans named `bc.query *`) / count(server request spans)
 *
 * Because a cached function that hits never executes its body, a `bc.query`
 * span *is* a cache miss. Target is <0.5 warm; measured by hand today at 0 for a
 * guest PDP and 1 for a signed-in one. Group by `bc.query.name` to see which
 * operation regressed, and alert on p99 `bc.graphql.complexity` — BigCommerce
 * enforces a per-request complexity budget, and a query that quietly grows broad
 * will hit it before anyone notices the page got slower.
 */
export function register(): void {
  // Intentionally empty. See above.
}
