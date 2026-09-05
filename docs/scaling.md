# Scaling to large catalogs

Written after asking what happens on a store with 1000+ categories and brands.
The honest answer at the time was "it degrades badly"; this documents what was
wrong and what the knobs are now.

## The dominant problem: per-page cost scaling with catalog size

Anything rendered in the header, footer, or mobile drawer appears on **every page
of the site**. Measured on the demo build: each top-level category appeared 6–12
times per page at ~95 bytes per link (HTML plus its duplicate in the RSC payload)
— roughly **570 bytes per category per page**.

The header was capped at 6. The footer and mobile drawer were not, and the drawer
rendered every category *and* its children. On a 1000-category store that is
~570KB added to every response, which dwarfs any caching win.

All three are now capped in one place:

```ts
// data/navigation.ts
export const NAV_LIMITS = { header: 6, footer: 8, mobile: 12 };
```

The drawer also dropped to top-level-only. Subcategories are one tap away on the
category page, which is where they belong — they don't need to ship on the cart
page.

## `categoryTree` cannot be paginated

Confirmed against the schema: `Site.categoryTree(rootEntityId: Int)` is the entire
signature. There is no `first:`. It always returns every top-level category, and
the only thing under our control is **selection depth**.

So a single query selecting three levels scales with the whole catalog. It was
replaced with:

| Function | Scope | Size at 1000 categories |
| --- | --- | --- |
| `getTopLevelCategories()` | 1 level, all top-level | tens of KB |
| `getCategoryBranch(rootEntityId)` | one branch, 2 levels | small, one entry per visible panel |
| `getSiteLinks()` | brands + CMS pages | bounded by `NAV_LIMITS.footer` |

Seven small cached entries instead of one huge one, and each panel invalidates
independently.

**Measured trade-off.** On the 3-category demo store, a cold start went from 1 nav
call to 5 (`TopLevelCategories` + 3 × `CategoryBranch` + `SiteLinks`). Warm is
unchanged at **0**. So this costs a few extra parallel round trips on a small
store to make the nav's cost proportional to what is *displayed* rather than to
catalog size. That is the right trade — the small-store case was never the one at
risk.

`getCategoryBranch` returns the root node with children nested, so the children
are unwrapped (verified live: `categoryTree(rootEntityId: 99)` →
`[{entityId: 99, name: "Accessories", children: [{entityId: 100, name: "Pots"}]}]`).

## Build-time cost of prerendering

Each seeded listing route costs **2 BigCommerce calls** at build
(`CategoryPage` + `SearchProducts`; settings and navigation are shared). Seeding
1000 categories and 1000 brands would be ~4000 build-time requests — minutes of
network against a rate- and complexity-limited API. For reference, `SearchProducts`
measured at complexity 4906 per call.

Seeding is now bounded:

```bash
STATIC_PARAMS_LIMIT=100   # default; 0 disables prerendering entirely
```

Categories are seeded breadth-first, so top-level ones — which carry the most
traffic — survive the cut. **This is a performance choice, not a correctness one:**
`dynamicParams` stays on, so unseeded routes still render, just with a chrome-only
shell until the first request warms the cache.

On a very large catalog, prefer `STATIC_PARAMS_LIMIT=0` plus a post-deploy
cache-warm job over the top URLs from the sitemap. That targets real traffic
instead of guessing, and it matters more than it looks: remote cache entries are
keyed by `buildId`, so **every deploy starts cold** regardless of seeding.

## BigCommerce hard limits found

- `brands(first:)` **cannot exceed 50**. `getBrandIds` paginates by cursor so the
  ceiling is `STATIC_PARAMS_LIMIT` rather than BigCommerce's page size. (An
  earlier note called the 50 an arbitrary cap of ours — it isn't, it's theirs.)
- `categoryTree` has no pagination at all (above).

## KV L1 cache sizing

`MemoryKvAdapter` caps entries, and route keys include the query string — so a
store with 2000 category and brand paths, plus products, plus `?utm_*` variants,
churns the default 4096. Eviction inside the 60s recheck window is actively
harmful: it sends requests down `with-routes`' *blocking* origin fetch instead of
its background refresh.

```bash
KV_MEMORY_MAX_ENTRIES=4096   # raise for large catalogs; entries are a few hundred bytes
```

## Still open

- **Product `generateStaticParams` (Phase 3).** Products are unbounded, so
  top-N-by-traffic seeding from the sitemap is the plan — not the whole catalog.
- **Facet cardinality at scale.** `shouldBypassCache` trips above 4 active facet
  groups; a store with many product attributes may need that tuned. Instrument
  hit rate per key shape before changing it.
- **No load testing has been done.** Every number here is measured on a
  4-category demo store or derived from per-entity costs. The extrapolations are
  arithmetic, not observation.
