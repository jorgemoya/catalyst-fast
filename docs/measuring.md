# Measuring cache behavior

The project KPI is **origin requests per storefront pageview** (plan Part 8).
Catalyst is roughly 6–10 for a guest PDP and the same for a logged-in one. Target
here is < 0.5 warm.

## The measurement trap

`next start` block-buffers stdout when it is piped to a file. A backgrounded

```bash
CLIENT_LOGGER=true pnpm start > server.log 2>&1 &
```

flushes the startup banner and then goes quiet for a long time. Grepping that file
after a few requests shows **zero** BigCommerce calls — which looks exactly like a
perfect cache hit and is completely wrong. This produced a false "zero calls"
reading during Phase 1 before it was caught.

`script -q` does not fix it from a backgrounded subshell either (it captures
nothing at all).

**Use a runner that streams the process's output**, or measure indirectly.

## Reliable signals

**1. Response headers.** `x-nextjs-cache: HIT` plus `x-nextjs-prerender: 1` means
Next served stored HTML without re-executing the route's render. No render means
no data functions ran, so the page contributed zero origin calls — this is
structural, not empirical. `x-nextjs-postponed: 1` means PPR streamed a dynamic
hole over a static shell.

**2. Timing.** A BigCommerce round trip is 100–500ms (observed: `GetStoreStatus`
139ms, `GetRouteQuery` 106ms). A prerendered serve is single-digit milliseconds.
If warm requests come back in ~3ms, no network call happened.

**3. Build output.** `○` = fully static, `◐` = partial prerender, and the
Revalidate/Expire columns show which `cacheLife` profile a route actually picked
up. A route landing on the wrong profile is visible here.

## Phase 1 baseline (home page, verified)

Cold request — proxy resolves the route, nothing cached yet:

```
KV MGET - Keys: …_/,…_storeStatus        ← miss
GetStoreStatus  - 138.97ms - complexity 1002
GetRouteQuery   - 106.48ms - complexity 1011
KV SET ×2
```

Five subsequent warm requests:

```
KV MGET (L1) - Keys: …_/,…_storeStatus   ← memory hit
KV MGET (L1) …
KV MGET (L1) …
KV MGET (L1) …
KV MGET (L1) …
```

**Zero BigCommerce calls**, 2.6–4.7ms per request. The page itself contributes
nothing because it is prerendered; the only per-request work is the proxy's route
lookup, which is served from the in-process L1 cache.

Note `complexity 1002` / `1011` on those two proxy queries — BigCommerce enforces
a complexity budget, and the client logs this header on every request. Worth
watching as queries are added.


## Phase 4 baseline — full sweep (measured)

`CLIENT_LOGGER=true next start`, production build, every route type warmed once
then hit ten times. Phase markers interleaved into the server log so calls
attribute to the right phase.

| Warm phase (×10 requests) | BigCommerce calls |
| --- | --- |
| `/` | **0** |
| `/shop-all/` | **0** |
| `/shop-all/?sort=newest` | **0** |
| `/zz-plant/` (PDP) | **0** |
| `/cart/` with items | **0** |
| `/` with a cart cookie (badge) | **0** |
| `/zz-plant/?fbclid=…` — unique value per request | **0** |

**70 warm requests, 0 origin calls.** Response times 6–13ms. The project KPI
(plan Part 8) is origin requests per storefront pageview, target < 0.5 warm;
measured 0. Catalyst is ~6–10 for a guest PDP and the same for a logged-in one.

Cold cost per route type, from the same run:

| Cold | Calls | Notes |
| --- | --- | --- |
| `/` | 8 | route, settings, nav ×5, featured + newest |
| `/shop-all/` | ~10 | shared chrome + `CategoryPage` + `SearchProducts` |
| PDP (seeded) | 7 | route + 5 product-scoped + `InventorySettings` |
| `/cart/` with items | 2 | `CartCount` + `CartPage` |

## Two caveats these numbers carry

**1. `use cache: remote` is not remote in this measurement.** `cacheHandlers` is
only wired when `CACHE_HANDLER=kv`, and on Vercel the platform supplies its own.
Locally neither applies, so `'use cache: remote'` falls back to the same
in-memory default handler as plain `'use cache'`. Every number above therefore
describes **one warm worker**. It does not demonstrate that entries are shared
across instances — that is exactly what the remote handler exists to do and it
should be re-measured against a real deployment.

**2. A route's first request after a restart is expensive, but only once.**

An earlier draft of this file claimed a cold route re-fetches the shared chrome
"and appears to do it twice", ~27 calls per request, and flagged it as an
unexplained ongoing cost. **That was wrong, and the correction is the useful
part.**

Measured directly: on a warm seeded PDP, after 35 seconds of idle (past the
route's 30s revalidate), the next request cost **1 call** — `ProductInventory`,
the one scope whose own `revalidate` had elapsed. Not a route re-render. The
immediately-following request cost 0.

| Seeded PDP | Calls |
| --- | --- |
| Immediately after warming | 0 |
| After 35s idle (past route revalidate) | **1** (`ProductInventory`) |
| Immediately after that | 0 |

So per-scope revalidation works exactly as designed: only the scope that expired
refetches, not the tree above it. The 27-call observation was the **first request
to a route after a server restart**, where the prerendered HTML exists on disk but
the `use cache` data entries do not — the already-documented "entries do not
survive the build" cost (`docs/scaling.md`), paid once per route per deploy, and
the reason a post-deploy cache-warm is the mitigation. It is not an ongoing cost
and does not scale with traffic.
