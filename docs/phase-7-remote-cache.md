# `use cache: remote` really is shared — measured

The whole architecture rests on one assumption: that a `'use cache: remote'`
entry written by one server instance is readable by every other instance, and
that invalidating a tag on one reaches all of them. Until now that was
**unverified**, because `createKVAdapter` falls back to `MemoryKvAdapter` when no
Upstash/Cloudflare/Vercel backing store is configured — and a per-process cache
makes "sharing" impossible to observe either way.

## How to re-run it

`scripts/fake-upstash.mjs` is a ~90-line server implementing just enough of the
Upstash REST protocol (`SET` with `EX`, `GET`, `MGET`, `/pipeline`) to back the
real `UpstashKvAdapter`. It exists so this proof needs no external service and no
credentials.

```bash
node scripts/fake-upstash.mjs &                     # shared store on :4010

export CACHE_HANDLER=kv \
       UPSTASH_REDIS_REST_URL=http://127.0.0.1:4010 \
       UPSTASH_REDIS_REST_TOKEN=test

CLIENT_LOGGER=true npx dotenv -e .env.local -- next start -p 3490 &   # A
CLIENT_LOGGER=true npx dotenv -e .env.local -- next start -p 3491 &   # B
```

Both instances must run the **same build** — the cache key includes the build id,
so two different builds would miss each other for reasons unrelated to sharing.

Count origin calls by grepping each instance's log for `[BigCommerce] <Op> - `,
excluding the ` KV ` lines (the KV logger shares the prefix — an early version of
this measurement counted them and reported nonsense).

## Results

| # | Action | BigCommerce calls on B |
|---|---|---|
| 1 | A warms `/garden/`, then **B** serves `/garden/` | **0** |
| 2 | **Control:** B serves `/bath/`, which neither warmed | **2** (`GetRouteQuery`, `CategoryPage`) |
| 3 | Write `nc:tag:products` into the shared store, B re-requests `/garden/` | **1** (`SearchProducts`) |

Read them together, because no one of them proves much alone:

- **(1) alone is worthless** — an instance that served nothing at all would also
  report zero. That is exactly why (2) is there: B does hit the origin when the
  entry is genuinely cold, so the zero in (1) is a real shared hit.
- **(3) is the one that matters for webhooks.** Simulating what a webhook
  receiver does — stamping a tag's revalidation timestamp into the shared store —
  made the *other* instance refetch. And it refetched precisely
  `SearchProducts`, the single operation tagged `products`, rather than
  everything on the page. Invalidation is both cross-instance and surgical.

## What this licenses, and what it does not

Licensed: the webhook receiver. Tag invalidation genuinely propagates, so mapping
`store/product/updated` to `revalidateTag(tags.product(id), 'max')` will affect
every instance, not just whichever one happened to receive the POST.

Not licensed: any assumption that entries survive a **deploy**. The cache key
embeds the build id, so a new deployment starts fully cold no matter how healthy
the shared store is — see plan §7.4 and the cache-warm job. This experiment
deliberately ran both instances off one build to isolate sharing from that.

Also worth knowing: `MemoryKvAdapter` remains the default locally, so an ordinary
`pnpm dev` or `pnpm start` **does not** get any of this. Sharing requires
`CACHE_HANDLER=kv` plus a configured backing store. Forgetting either is silent —
you simply get a per-process cache and slower origin numbers, with nothing in the
logs to say why.

---

# Webhook receiver — verified end to end

`app/api/webhooks/bigcommerce/route.ts` turns BigCommerce change events into tag
invalidations. Registered by `pnpm register-webhooks`.

Run against two instances sharing one store (setup above), with
`BIGCOMMERCE_WEBHOOK_SECRET` set:

| Step | Instance B origin calls |
|---|---|
| A warms `/garden/`, B serves it | 0 |
| `POST /api/webhooks/bigcommerce/` **to A only** → `{"invalidated":3}` | — |
| B re-requests `/garden/` | **1** (`SearchProducts`) |
| B requests once more | 0 |

The third row is the whole point: a webhook delivered to *one* instance
invalidated an entry being served by *another*, and did it surgically — only the
operation tagged `products` refetched. The fourth row confirms the invalidation
fired once rather than wedging the entry permanently stale.

## Two traps found while building this

**The destination URL needs its trailing slash.** `trailingSlash: true` means a
POST to `/api/webhooks/bigcommerce` returns **308**, and webhook senders do not
generally replay a POST body across a redirect. The subscription then looks
healthy from BigCommerce's side — a 308 is not an error — while silently never
invalidating anything. `register-webhooks.ts` appends the slash for this reason;
do not "tidy" it away.

**`export const dynamic` is rejected under `cacheComponents`.** The build fails
with "Route segment config 'dynamic' is not compatible with
nextConfig.cacheComponents". It is also unnecessary: a POST handler that reads
its body is dynamic by construction.

## Auth

BigCommerce does not sign webhook bodies, so the shared secret travels in an
`x-webhook-token` header set at subscription time and is compared with
`timingSafeEqual`. With no secret configured the endpoint **401s everything**
rather than accepting anything — an unauthenticated cache-purge URL is a
denial-of-service lever aimed at your own origin.

Verified: no token → 401 · wrong token → 401 · malformed JSON → 400 · GET probe →
200 · unmodelled scope → 200 with `invalidated: 0` (never 4xx, or BigCommerce
retries and eventually deactivates the subscription).

---

# Post-deploy cache warming

`pnpm warm-cache` — see `scripts/warm-cache.ts`.

A remote cache key includes the build id, so **every deploy starts cold** however
healthy the shared store is. Sharing works only between instances on the *same*
build, which the cross-instance experiment above deliberately held constant. So
the first traffic wave after a deploy hits BigCommerce at full force.

Run it **after** the new deployment is live. Warming the old build warms entries
the new one will never read.

Measured against a local production server, 10 paths at concurrency 2:

```
warmed 10/10 in 3.6s
BigCommerce GraphQL calls absorbed by the warmer: 87
BigCommerce GraphQL calls for the next visitor to a warmed PDP: 0
```

## Two things that were wrong before they were right

**Sitemap `<loc>` values are XML-escaped.** Child sitemaps arrive as
`xmlsitemap.php?type=products&amp;page=1`, and fetching that literally 404s —
it parses as a single `type` parameter whose value contains `&amp;page=1`. The
first version of this script walked the index, failed every child, and reported
success having warmed exactly one path (`/`). Entities are decoded before use.

**Child sitemap order is not priority order.** BigCommerce lists `pages` first,
which on a B2B-enabled store is mostly account routes — `/address-book/`,
`/quote/`, `/buy-again/`. Those are auth-gated and uncacheable, so warming them
spends the budget and achieves nothing. Children are sorted products →
categories → brands → rest.

`--dry-run` prints the paths without requesting them; use it to confirm you are
about to warm products rather than account pages.

## A caveat on counting

Both the KV logger and the GraphQL client log with a `[BigCommerce]` prefix, so
`grep -c BigCommerce` over-reports origin load — it counts `KV MGET` lines as
queries. This bit two separate measurements in this project. Count with
`grep -oE '\[BigCommerce\] [A-Za-z]+ - ' | grep -v ' KV '`.
