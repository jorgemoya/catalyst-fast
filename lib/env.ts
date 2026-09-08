import { z } from 'zod';

/**
 * Typed environment schema. Catalyst had none — env vars were read ad hoc via
 * `process.env.X` across ~30 files with inconsistent fallbacks, so a missing
 * store hash surfaced as a confusing 401 from BigCommerce rather than a startup
 * error. Parse once, fail loudly.
 *
 * Server-only values. Anything the browser needs must be NEXT_PUBLIC_ and read
 * directly, since `process.env` is not fully populated client-side.
 */
const envSchema = z.object({
  BIGCOMMERCE_STORE_HASH: z.string().min(1, 'BIGCOMMERCE_STORE_HASH is required'),
  BIGCOMMERCE_STOREFRONT_TOKEN: z.string().min(1, 'BIGCOMMERCE_STOREFRONT_TOKEN is required'),
  BIGCOMMERCE_CHANNEL_ID: z.string().min(1).default('1'),
  BIGCOMMERCE_GRAPHQL_API_DOMAIN: z.string().default('mybigcommerce.com'),
  BIGCOMMERCE_TRUSTED_PROXY_SECRET: z.string().optional(),

  BC_MAX_CONCURRENCY: z.coerce.number().int().positive().default(16),

  /**
   * Shared secret for the webhook receiver, sent by BigCommerce as
   * `x-webhook-token` because BigCommerce does not sign webhook bodies.
   *
   * Optional in the schema but **fails closed at the endpoint**: with no secret
   * configured the receiver 401s everything. An unauthenticated cache-purge URL
   * is a denial-of-service lever pointed at your own origin, so "not configured"
   * must mean "refuses traffic", never "accepts anything".
   */
  BIGCOMMERCE_WEBHOOK_SECRET: z.string().optional(),

  /**
   * Management API token (not the storefront token) and the publicly reachable
   * origin, used only by `scripts/register-webhooks.ts`. Never read at runtime.
   */
  BIGCOMMERCE_ACCESS_TOKEN: z.string().optional(),
  WEBHOOK_DESTINATION_ORIGIN: z.string().optional(),

  KV_NAMESPACE: z.string().optional(),
  KV_MEMORY_MAX_ENTRIES: z.coerce.number().int().positive().default(4096),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  /**
   * How many category/brand routes to prerender. Each costs 2 BigCommerce calls
   * at build time. 0 disables prerendering (correctness is unaffected —
   * `dynamicParams` covers the tail).
   */
  STATIC_PARAMS_LIMIT: z.coerce.number().int().nonnegative().default(100),

  /**
   * Customer group ids that actually have a price list attached, comma-separated
   * (e.g. `3,7`). **Empty by default, which is the correct setting for most
   * stores.**
   *
   * The overlay in `data/customer/pricing.ts` used to fire for any non-default
   * group, inferring "non-default group" implies "different prices". That
   * inference is wrong: a store can group customers for reasons that have nothing
   * to do with pricing. Measured against this store, group 3 had *identical*
   * prices on all 15 products, so every signed-in PDP paid a `CustomerPrices`
   * round trip to re-derive the number already sitting in the cached shell.
   *
   * Group pricing is not discoverable from the Storefront API — price lists live
   * behind the Management API — so this cannot be detected at runtime and has to
   * be declared. Declaring nothing costs nothing, which is the right default.
   */
  PERSONALIZED_PRICE_GROUPS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((part) => Number(part.trim()))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),

  /**
   * Signs and encrypts the customer session. Optional on purpose: without it the
   * storefront runs guest-first exactly as it did through Phase 5, and only
   * account features go dark. A missing secret must not take down a store that
   * never enabled accounts. See `lib/auth/index.ts`.
   */
  AUTH_SECRET: z.string().optional(),
  AUTH_TRUST_HOST: z.string().optional(),

  /**
   * Analytics providers. Each is independently optional and self-disabling — a
   * provider with no credentials reports `enabled: false` and is skipped, so the
   * storefront ships measuring nothing until a merchant opts in.
   *
   * Not read through this schema at send time (see `lib/analytics/types.ts` on
   * why `enabled()` is a function), but declared here so the full set of
   * configuration is discoverable in one place.
   */
  GA_MEASUREMENT_ID: z.string().optional(),
  GA_API_SECRET: z.string().optional(),
  BIGCOMMERCE_DATA_EVENTS_TOKEN: z.string().optional(),

  /**
   * reCAPTCHA v3. The site key is public and **must** carry the NEXT_PUBLIC_
   * prefix to reach the browser; the secret key must never have it. Both must be
   * present for verification to engage at all — with either missing,
   * `verifyRecaptcha` returns true so an unconfigured install still accepts
   * reviews and contact messages.
   */
  NEXT_PUBLIC_RECAPTCHA_SITE_KEY: z.string().optional(),
  RECAPTCHA_SECRET_KEY: z.string().optional(),

  TRAILING_SLASH: z.string().optional(),
  CLIENT_LOGGER: z.string().optional(),
  KV_LOGGER: z.string().optional(),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  VERCEL: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

function parseEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `Invalid environment configuration:\n${issues}\n\nCopy .env.example to .env.local and fill it in.`,
    );
  }

  return parsed.data;
}

/**
 * Lazily parsed and memoized.
 *
 * Deliberately not evaluated at module load. The BigCommerce client is
 * constructed at module scope and is reachable from `proxy.ts`, so eager parsing
 * would make `next build` fail outright in any environment without production
 * secrets — CI, a fresh clone, a docs build. Deferring to first property access
 * means routes that never touch BigCommerce build and render fine, and anything
 * that does touch it fails at request time with the message above rather than an
 * opaque 401 from the API.
 */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop: string) {
    cached ??= parseEnv();

    return cached[prop as keyof Env];
  },
});
