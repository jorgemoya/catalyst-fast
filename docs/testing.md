# Testing

```bash
pnpm test     # vitest — pure domain logic
pnpm e2e      # playwright — rendering and interaction, against a production build
```

## Why both, and why e2e specifically

Three bugs shipped in Phases 1–2 that **typecheck, lint, and build all passed**:

| Bug | Why static analysis couldn't see it |
| --- | --- |
| Top-level nav rendered as inert `<span>`s | Valid TSX; the missing `href` was a prop I never wired |
| "Shop all X" duplicated after the nav split | Two correct components, each rendering one link |
| Refinement links built from the internal `/category/98` path | A correct string, just the wrong one |

Two more surfaced *while writing* the e2e suite:

| Bug | Found by |
| --- | --- |
| Product card's stretched link (`after:inset-0`) escaped its card and swallowed clicks across the page — the `<article>` wasn't `position: relative`, so the pseudo-element resolved against a far ancestor | Playwright reporting `<a href="/dracaena/"> … intercepts pointer events` when clicking a facet |
| Sticky header covered anything scrolled into view — anchor links, keyboard focus, `scrollIntoView` | Playwright's actionability check timing out on an obscured element |

Both were live, user-facing defects. Neither is expressible as a type.

## Unit tests (`domain/**/*.spec.ts`)

The domain layer is pure functions over plain data — no DOM, no server runtime,
no BigCommerce. That is the reason it lives in `domain/` rather than inside the
cached `data/` functions.

- **`listing-params.spec.ts`** — the highest-value suite in the repo. Cache
  correctness *is* canonicalization: two URLs meaning the same thing must produce
  identical keys, or the remote cache fills with single-use entries and the page
  ends up slower than no cache at all. Covers all five rules plus the
  merchant-default-sort collapse.
- **`facets.spec.ts`** — all eight BigCommerce facet types via fixtures.
  Deliberate: the demo store only surfaces Brand, Price, Other, and (on Shop All)
  Product Attributes, so Category-with-nesting and Rating would otherwise be
  written-but-never-run while the docs claimed full coverage. Fixtures are the
  honest way to exercise a path the available data can't reach.
- **`price.spec.ts`** — tax display modes and the BOTH→EX degradation.
- **`listing-url.spec.ts`** — every refinement link, including the vanity-path
  property that the internal-path bug violated.

## E2E (`e2e/*.spec.ts`)

Runs against a **production build**, not `next dev`. Everything the suite
protects — static shells, PPR streaming, proxy rewrites — behaves differently in
dev, so testing dev would test the wrong thing.

Covers: nav items are navigable, exactly one "Shop all" link per panel, internal
routes 404, bogus vanity URLs 404, the listing shell contains real content rather
than skeletons, refinement links stay on the vanity path, facets narrow results,
sorting works, tracking params don't change output, pagination advances, and the
empty state renders.

### Gotcha: PPR responses contain two copies of everything

A PPR document holds both the cached fallback and the streamed result, so a
text-matching selector is ambiguous by construction — this cost real time twice,
once making filters look broken and once as a strict-mode violation. Hence
`data-testid="result-count"` and `.last()` throughout: the streamed value comes
after the fallback in DOM order.

Same artifact appears when reading HTML by hand — see the note in
`phase-0-spikes.md` about `SELECTED-<!-- -->42`.

## Cache hit rate

`use cache` exposes no hit/miss signal, but a cached function's body only runs on
a miss — so logging inside it counts misses exactly.

```bash
CACHE_MISS_LOGGER=true pnpm start
```

Logs the *key shape* rather than the key, since which facets are engaged is what
predicts hit rate and concrete values are unbounded.

Measured over a realistic mix (29 listing requests):

| Traffic | Requests | Misses |
| --- | --- | --- |
| Unfiltered | 20 | 1 |
| 5 **distinct** `?utm_source=` values | 5 | **0** |
| `?brand=41` | 3 | 1 |
| `?minPrice=50` | 1 | 1 |
| **Total** | **29** | **3** |

**96% hit rate on the default key** (25 requests, 1 miss) against the plan's >90%
bar; 89.7% overall. The five distinct tracking-param URLs producing zero misses
is canonicalization working end to end.

## Not covered

- **Load testing.** Every scaling number in `docs/scaling.md` is measured on a
  4-category store or derived arithmetically.
- **`shouldBypassCache`** is unit-tested but never exercised against a real store
  — the demo catalog can't produce more than four active facet groups.
- **Visual regression.** No screenshot diffing; layout bugs that don't break
  actionability would still slip through.
