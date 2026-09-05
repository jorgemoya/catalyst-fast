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
