# Phase 0 spike results

Three assumptions the architecture rests on, verified against Next.js 16.3.4 with
`cacheComponents: true` and `partialPrefetching: true`, on a production build
served by `next start`. All three passed, so no fallback plan is needed.

Re-run these if the Next minor version changes — every one of them depends on
behavior that is not part of a documented stability guarantee.

---

## Spike 1 — a proxy rewrite still serves the prerendered shell ✅

**Why it mattered.** The whole design keeps Catalyst's middleware-based vanity-URL
resolution *and* expects routes to be prerendered. If `NextResponse.rewrite()`
forced the target to render on demand, every storefront page would lose its
static shell and the caching work would buy far less than intended. This was the
single biggest structural risk in the plan.

**Test.** A proxy rewriting `/spike-vanity-url/` → `/spikes/rewrite-target`, where
the target is a static page containing a known marker.

**Result.**

```
HTTP/1.1 200 OK
x-nextjs-cache: HIT
x-nextjs-prerender: 1
x-nextjs-stale-time: 300
→ marker present
```

Identical headers to requesting the target directly. **A rewrite hits the
prerender cache.** Keeping the proxy costs one middleware invocation per request
and nothing else.

**Incidental finding, and a real trap.** With `trailingSlash: true` (BigCommerce's
default, and ours), paths arrive at the proxy *with* a trailing slash. A matcher
written against the unslashed form silently never fires — the first attempt at
this spike 404'd for exactly that reason. `proxies/with-routes.ts` passes
`pathname + search` straight to BigCommerce, which also uses trailing slashes, so
it agrees by construction — but any new path comparison added to the proxy must
normalize first. This is the same class of bug `normalizeForCompare` exists to
prevent for redirects.

---

## Spike 2 — `cache: 'no-store'` is legal inside a `'use cache'` body ✅

**Why it mattered.** `lib/bigcommerce/index.ts` sets `cache: 'no-store'` on every
request on purpose: `use cache` owns caching, and letting the fetch layer cache
too would give two caches with different keys, lifetimes, and invalidation — a
large part of what makes Catalyst's caching hard to reason about. If Next rejected
the combination, `query()` would have had to be redesigned.

**Test.** A `'use cache'` function with `cacheLife('minutes')` performing a
`no-store` fetch, called twice in one render.

**Result.** Builds clean, and the route is fully static:

```
○ /spikes/no-store-in-cache          1m      1h
```

The `1m` / `1h` revalidate/expire come from the `minutes` profile, confirming the
cached wrapper — not the fetch — is governing the entry. **`query()`'s design
stands as written.**

---

## Spike 3 — a cached component inside a Suspense fallback lands in the shell ✅

**Why it mattered.** This is the trick the PLP depends on (plan §4.4). Reading
`searchParams` makes a subtree dynamic, so a naive faceted page is a dynamic hole
for the ~95% of visits that carry no filters. Nesting a *cached* default render
inside the fallback is what recovers the static shell for the common case. It was
clever enough to be worth proving before building a page type on it.

The nesting is required because a Suspense fallback must not itself suspend:

```tsx
<Suspense
  fallback={
    <Suspense fallback={<GridSkeleton />}>
      <DefaultGrid categoryId={id} />   {/* 'use cache' → prerendered */}
    </Suspense>
  }
>
  <FilteredGrid categoryId={id} selection={searchParams} />
</Suspense>
```

**Result.** The route is a partial prerender, carrying the *cached* component's
`cacheLife`:

```
◐ /spikes/nested-fallback           15m      1d
```

The prerendered HTML on disk contains `DEFAULT-VARIANT` and **not** `skeleton` —
the cached default, not the placeholder, is what gets prerendered. Requesting the
route with a selection returns `x-nextjs-postponed: 1` and streams the dynamic
render over the top:

```html
<p data-testid="selected">SELECTED-<!-- -->42</p>
```

**Both halves work: cached default in the shell, dynamic selection streamed.**

> Note when verifying this by hand: `grep` for the interpolated value will miss it.
> React splits `SELECTED-{v}` into separate text nodes, so the HTML reads
> `SELECTED-<!-- -->42`. Match on the `data-testid` instead.

---

## Spike 4 (unplanned) — `await params` at the top of a page blocks prerendering ⚠️

Found while verifying end-to-end vanity-URL resolution. **This corrects the PDP
sketch in the plan (§4.2)**, which opens with:

```tsx
export default async function ProductPage({ params }: Props) {
  const productId = Number((await params).id);   // ← blocks prerendering
```

Under `cacheComponents`, that fails the build outright:

```
Error: Route "/category/[id]": Next.js encountered uncached or runtime data during prerendering.
`fetch(...)`, `cookies()`, `headers()`, `params`, `searchParams`, or `connection()`
accessed outside of <Suspense> prevents the route from being prerendered.
```

`params` is runtime data exactly like `searchParams` unless the value is known at
build time. Three ways forward, in preference order:

1. **Don't await `params` in the page body.** Keep the page a non-async function
   and pass the promise down into a child inside `<Suspense>`, so only that
   subtree is dynamic:

   ```tsx
   export default function ProductPage({ params }: Props) {
     return (
       <ProductPageLayout>
         <Suspense fallback={<HeadingSkeleton />}>
           <ProductHeading params={params} />
         </Suspense>
       </ProductPageLayout>
     );
   }
   ```

2. **Provide `generateStaticParams`.** For params enumerated at build time the
   value *is* statically known, so awaiting is fine for those entries — but
   `dynamicParams: true` still has to satisfy rule 1 for everything outside the
   seeded set.

3. `export const instant = false` — a blocking route. Escape hatch only, and it
   should carry a tracking issue rather than become a resting state.

Practical consequence for Phase 2/3: components take `params`/`searchParams` as
**promises** and await them at the leaf, one boundary in. That is a slightly
different shape from the plan's `productId={productId}` sketch — the identity
prop becomes a promise, resolved inside the Suspense boundary that owns it.

---

## Trailing slash: `TRAILING_SLASH=true` (settled)

BigCommerce canonical URLs carry a trailing slash — `site.categoryTree` returns
`/shop-all/` — so the app canonicalizes the same way. Anything else costs a 308
hop on every inbound link using BC's own form: crawlers, sitemap entries, and
merchant-published links.

This was briefly set to `false`, which produced exactly that:

```
false:  GET /shop-all/  → 308 → GET /shop-all  → proxy → /category/97 → 200
true:   GET /shop-all/                          → proxy → /category/97 → 200
```

It matters most at Phase 5, when `sitemap.xml` proxies BigCommerce's own sitemap:
with `false`, every URL in our own sitemap would have redirected, and canonical
tags would have disagreed with it. Keeping `true` makes the sitemap correct by
pass-through.

Three behaviors verified against the live store while settling this:

1. **`site.route` is tolerant of both forms.** Same entity either way, so
   resolution is never wrong because of a slash:
   ```
   route("/shop-all/") -> { __typename: "Category", entityId: 97 }
   route("/shop-all")  -> { __typename: "Category", entityId: 97 }
   ```

2. **KV keys never fork.** Next normalizes `request.nextUrl.pathname` *before* the
   proxy runs, under both settings — the observed key was `v1_/shop-all`
   (unslashed) whether the request was slashed or not. So BigCommerce is always
   queried with the unslashed form, and there is exactly one cache entry per path.

3. **Rewrites are exempt from trailing-slash normalization.** Rewriting to
   `/category/97` under `trailingSlash: true` does NOT emit a 308 to
   `/category/97/`, so the internal path never leaks to the browser. This is why
   upstream Catalyst can slash `/webpages/{id}/normal/` but not `/category/{id}`
   without consequence — rewrite targets simply don't need to match the setting.

End-to-end chain, confirmed live:

```
/shop-all/  → proxy site.route → rewrite /category/97 → renders 97
/plants/    → proxy site.route → rewrite /category/98 → renders 98
/shop-all   → 308 → /shop-all/  (canonicalization, as intended)
```

**Still untested:** BigCommerce 301 redirect rules match on `fromPath`, which BC
stores slashed. Since the proxy queries with the *unslashed* form (point 2), a
merchant redirect configured for `/old-page/` may or may not match a lookup for
`/old-page`. Node resolution is tolerant (point 1) but redirects are a separate
resolver path. Exercise this in Phase 5 with a real redirect rule on the store.

---

## Also confirmed

- The root layout reads nothing request-scoped, so `/`, `/maintenance`, and
  `/_not-found` all report `○ (Static)`. This is the property Catalyst gave up by
  reading cookies in its root layout, which forced every route beneath it dynamic.
- `cacheLife` profiles registered in `next.config.ts` show up verbatim in the
  build's Revalidate/Expire columns — a fast way to spot a route that picked up
  the wrong profile.
