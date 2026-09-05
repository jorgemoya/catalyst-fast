# Phase 2 — listing pages (category + brand)

## Result

`/plants/` (a merchant vanity URL, resolved by the proxy to `/category/98`):

| | |
| --- | --- |
| In the prerendered shell | h1, breadcrumbs, **20 products with prices**, **result count**, **3 facet groups** (Brand, Price, Other) |
| Unfiltered warm request | 0 BigCommerce calls |
| Filtered warm request | 0 BigCommerce calls |
| Filtered cold request | **1** call (`SearchProducts`) |
| Junk params (`?utm_source=…&fbclid=…`) | 0 calls — shares the unfiltered entry |

Measured across 9 warm requests spanning unfiltered, filtered, and junk-param
URLs: **0 BigCommerce data calls**.

## What made it work

### One query, four consumers

Facets, result count, product grid, and pagination all call `searchListing(key)`
with the same canonical key, so they resolve from one cache entry and one origin
request. Composing the page from independent components would otherwise multiply
requests — this is the "one query per (cache key, cacheLife) tuple, not per
component" rule doing real work.

The facet disabled-state computation needs *two* reads (unrefined vs refined, to
grey out options that would yield zero results rather than letting them vanish).
The unrefined read uses `defaultKey(key)` — the identical entry the default grid
and every unfiltered visitor already use. Confirmed in the logs: the filtered
request issued exactly **one** `SearchProducts` call, because the "all facets"
read was already warm.

### `generateStaticParams` is what puts products in the shell

The first build had both listing routes at `30m` revalidate — the `navigation`
profile, i.e. **only the header chrome was prerendered**. Cause: `await params`
makes everything below it runtime data (Phase 0, spike 4), and without static
params the category id isn't known at build time.

Seeding fixed it — seeded routes moved to `10m / 2h` (the `listing` profile), and
the prerendered HTML gained real products.

> **Corrected.** This originally said both sets are "bounded (tens, not
> thousands), so exhaustive seeding is correct here." That generalized from a
> 4-category demo store and is wrong. Seeding is now bounded by
> `STATIC_PARAMS_LIMIT` (default 100) — see `docs/scaling.md`.

The unseeded `/category/[id]` fallback stays at `30m` — correct behavior for a
category created after the build.

### Canonicalization

`domain/listing-params.ts` is what keeps the cache hit rate up. Search params are
unbounded, and every distinct key is a distinct entry — without discipline the
cache fills with single-use entries and the page ends up slower than no cache at
all, because it pays writes on top of the same origin requests.

Verified: `/plants/?utm_source=nl&fbclid=xyz` returns a byte-identical product set
and count to `/plants/`, with zero origin calls.

Rules applied, in order: drop unknown keys → sort keys and multi-values → drop
values equal to the default (including the merchant's configured
`defaultProductSort`, so `?sort=newest` on a newest-default category collapses) →
clamp page depth → bypass the cache entirely above 4 active facet groups.

### Facets are links, not an island

Every facet control is a server-rendered `<a>` or a plain GET form.
`domain/listing-url.ts` computes the href. Consequences: refinement works with JS
disabled, every refined view has a crawlable URL, and the router prefetches on
hover. Catalyst's equivalent (`filters-panel.tsx`) was 373 lines of `'use client'`
that received raw promises and called `use()` on them.

The only client island on the page is `SortSelect` (~30 lines) — a `<select>`
genuinely can't navigate on change without JS.

Collapse/expand uses `<details>`/`<summary>`, honoring the merchant's
`isCollapsedByDefault`, with no JS at all.

## Known trade-off: filtered direct-loads flash unfiltered content

The grid's Suspense fallback is the *cached unfiltered view*, so a shell exists
with real products. On a direct load of a filtered URL, the shopper briefly sees
the unfiltered result before the filtered one streams over it. Observed for
`?minPrice=50&maxPrice=80`: the document contains count `14` (fallback) followed
by count `3` (streamed).

This is the right default — the overwhelming majority of listing traffic is
unfiltered, and those visitors get real content instantly instead of a skeleton.
Filtering usually happens as a *client-side* navigation from the unfiltered page,
where React holds the previous UI rather than showing a fallback, so the flash
doesn't occur there either. It only affects direct or shared links to a filtered
URL.

The fallback can't branch on whether filters are present without reading
`searchParams`, which would make it dynamic and defeat the whole mechanism. If
this becomes a real complaint, the fix is a client-side check that swaps in a
skeleton when `location.search` has filter params — but that costs JS to solve a
problem most visitors never see.

## Verification gotcha

Grepping a PPR response for a single value reads the **fallback**, not the
streamed content — both are in the same document. An early check here made all
four filter permutations look identical and suggested filtering was broken. Match
all occurrences and compare the sequence instead:

```
unfiltered                → counts ['14', '14']
?minPrice=50&maxPrice=80  → counts ['14',  '3']   ← fallback, then filtered
?sort=price-asc           → 22 distinct products vs 20   ← reordered
```

Same class of artifact as the `SELECTED-<!-- -->42` text-node splitting noted in
`phase-0-spikes.md`.

## Deferred

- Compare (needs the compare drawer and `/compare`).
- Customer-group catalog visibility — the negative-result route fallback lands
  with auth in Phase 6.
- Search page (`/search`) reuses `ListingPage` in Phase 5; the term is already
  threaded through `ListingKey`.
