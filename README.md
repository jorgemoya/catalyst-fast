# catalyst-fast

A cacheable, guest-first BigCommerce storefront built on Next.js 16 Cache Components.

A ground-up rebuild of [Catalyst](https://github.com/bigcommerce/catalyst). The
plan, including the full feature-parity inventory and what was salvaged from
upstream, lives at `~/.claude/plans/i-have-a-catalyst-scalable-backus.md`.

## What's different

Catalyst renders every page dynamically: its root layout reads cookies, nothing
uses `use cache`, and the idiom `customerAccessToken ? { cache: 'no-store' } : …`
appears at ~76 call sites — so logged-in users get zero HTTP caching, even for
data that is byte-identical across all customers.

Three rules replace that:

1. **Every BigCommerce read lives in `data/`, and its kind is visible from its
   path.** `data/` is public, cached, and never sees a customer token.
   `data/customer/` is customer-scoped and never server-cached. Enforced by
   `npm run cache-audit` and an ESLint boundary, not by convention.
2. **Components fetch their own data.** Props carry identity (`productId`) and
   layout slots (`children`) — never data. This replaces upstream's `Streamable`
   promise-passing and its 27–43-prop section components.
3. **The cache directive follows the rendering position**, not just the data.
   `stale >= 300` puts a scope in the prerendered shell; below that it's a
   streamed hole. See `lib/cache/profiles.ts`.

## Setup

Requires Node 22+ and pnpm.

```bash
pnpm install
```

Create `.env.local` with at minimum:

```bash
# Store hash from https://store-{hash}.mybigcommerce.com
BIGCOMMERCE_STORE_HASH=

# Storefront API JWT — NOT an OAuth access token. The client throws
# InvalidStorefrontTokenError on a 401 if it isn't JWT-shaped.
# POST /stores/{store_hash}/v3/storefront/api-token
BIGCOMMERCE_STOREFRONT_TOKEN=

BIGCOMMERCE_CHANNEL_ID=1
```

Optional:

```bash
BIGCOMMERCE_GRAPHQL_API_DOMAIN=      # defaults to mybigcommerce.com
BIGCOMMERCE_TRUSTED_PROXY_SECRET=
BC_MAX_CONCURRENCY=16                # in-flight cap on requests to BigCommerce
TRAILING_SLASH=true                  # must match next.config.ts
CACHE_HANDLER=kv                     # self-hosting only; backs `use cache: remote`
UPSTASH_REDIS_REST_URL=              # shared KV for proxy route resolution
UPSTASH_REDIS_REST_TOKEN=
KV_NAMESPACE=                        # defaults to the store hash
CLIENT_LOGGER=true
KV_LOGGER=true
```

Then generate the typed schema and start:

```bash
pnpm generate   # writes bigcommerce.graphql + bigcommerce-graphql.d.ts
pnpm dev
```

`pnpm generate` requires a reachable store — the rest of the app won't typecheck
until it has run once, because `lib/bigcommerce/graphql.ts` imports the generated
introspection types.

## Scripts

| Script | Purpose |
| --- | --- |
| `pnpm dev` / `pnpm build` | Both run `build-config` first (see below) |
| `pnpm generate` | Regenerate the GraphQL schema + gql.tada types from the live store |
| `pnpm build-config` | Snapshot merchant URLs into `lib/config/build-config.json` |
| `pnpm cache-audit` | Fail if `data/` violates the public/customer boundary |
| `pnpm typecheck` / `pnpm lint` | |

`build-config` runs as a `prebuild`/`predev` step rather than from inside
`next.config.ts`. Catalyst fetched these settings during config resolution, which
pulled `next/headers` into the module graph early enough to poison
AsyncLocalStorage under pnpm and required dynamic-`import()` workarounds
throughout its client. Here `next.config.ts` only ever reads a validated JSON file.

## Layout

```
app/            routes; page shells stay data-free, dynamic bits live in <Suspense>
proxy.ts        route resolution only — every proxy is a tax on every request
proxies/        with-routes: BigCommerce vanity URL → internal route, KV-cached SWR
data/           PUBLIC data access. cached, scalar args, no customer token
  customer/     customer-scoped. dynamic or 'use cache: private'
domain/         pure functions, no I/O (replaces upstream's data-transformers)
lib/
  bigcommerce/  vendored + purified client; query() vs customerQuery()
  cache/        tags, cacheLife profiles, self-hosted CacheHandler
  kv/           multi-runtime SWR store (Vercel / Cloudflare / Upstash / memory)
ui/
  primitives/   Base UI + Tailwind 4
  patterns/     commerce-aware compositions
  layout/       header, footer, page shells
styles/         theme.css IS the design system contract (Tailwind 4 is CSS-first)
docs/           phase-0-spikes.md — verified framework behavior, re-run on upgrade
```

## Status

**Phase 0 complete** — scaffold, purified client, KV, proxy, cache taxonomy,
theme, and four framework spikes (see `docs/phase-0-spikes.md`).

**Phase 1 complete** — header with server-rendered mega-menu, footer, home page,
product card, and the settings/navigation/products data layer.

Phase 1's acceptance bar was met and measured (`docs/measuring.md`):

| | |
| --- | --- |
| `/` in build output | `○ (Static)` — fully prerendered, header and footer included |
| Warm request | **0 BigCommerce calls**, 2.6–4.7ms |
| Per-request work | one in-process L1 cache hit in the proxy |
| Cold request | 2 calls (`GetStoreStatus`, `GetRouteQuery`), then cached |

**Phase 2 complete** — category and brand listings with all facet types, sort,
cursor pagination, breadcrumbs, and canonicalized cache keys
(`docs/phase-2-listing.md`).

| | |
| --- | --- |
| In the listing shell | title, breadcrumbs, 20 products, result count, 3 facet groups |
| Warm request (filtered or not) | 0 BigCommerce calls |
| Cold filtered request | 1 call — the unrefined facet read shares the default entry |
| `?utm_source=…&fbclid=…` | 0 calls, identical output — canonicalized away |

**Phase 3 complete** — product detail page with all 11 option types, gallery,
client-owned variant selection, specs, reviews, related products, and JSON-LD
(`docs/phase-3-pdp.md`).

| | |
| --- | --- |
| In the PDP shell | title, gallery, price, stock, CTA, specs, description |
| Warm request | 0 BigCommerce calls |
| Cold request | 5 product-scoped queries (Catalyst: 7) |
| Seeded products | `○ (Static)` — fully prerendered, 30s revalidate |

Tests: `pnpm test` (105 unit) and `pnpm e2e` (21 Playwright). See
`docs/testing.md` — five bugs have shipped past typecheck, lint, and build.

Next: Phase 4 — cart and checkout handoff. Establishes the
`updateTag` + `refresh()` invalidation contract.
