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
