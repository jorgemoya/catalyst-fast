# Phase 3 — product detail page

## Result

`/zz-plant/` (vanity URL, resolved by the proxy to `/product/…`):

| | |
| --- | --- |
| In the shell | title, breadcrumbs, gallery + thumbnails, **default price**, **default stock**, functional CTA, specifications, description |
| Also rendered | reviews, related products, Product JSON-LD |
| Warm request | **0 BigCommerce calls** |
| Cold request | 5 product-scoped queries |
| Seeded products in build output | `◐ (Partial Prerender)`, 30s revalidate |

Everything in the page *body* is prerendered — nothing there reads request state,
so price and stock are prerendered too. The 30s revalidate is the `inventory`
profile, the shortest read on the page, which is what keeps prerendered stock
honest.

> **Amended in Phase 4.** This route reported `○ (Static)` when the phase closed.
> It is now `◐` because the shared header gained a cart badge, which is a
> `'use cache: private'` scope and therefore excluded from shell generation by
> construction. The PDP's own content did not move out of the shell — the change
> is one streamed hole in the chrome, on every route at once. See
> `docs/phase-4-cart.md`.

> **Correction to the plan.** §4.2 projected "4 product-scoped queries vs
> Catalyst's 7". The real number is **5** (`ProductPage`, `ProductPrices`,
> `ProductInventory`, `ProductReviews`, `RelatedProducts`) — the projection hadn't
> counted reviews and related products separately. Still fewer than Catalyst, and
> `InventorySettings` is site-level so it costs nothing per product.

## What replaced the Streamable DAG

Catalyst's PDP built **17** `Streamable.from` closures into a hand-wired
dependency graph and passed the promises into a `ProductDetail` with ~43
props/fields. Here each region is an independent async Server Component behind
its own `<Suspense>`, reading from a shared cached function. Fewer queries, no
promise-passing across the RSC boundary, and each region is separately testable.

`domain/availability.ts` extracts the ~180 lines of stock/backorder rules that
sat inline across several of those closures. As pure functions they now have 25
unit tests — the branching is intricate enough that getting it wrong
misrepresents delivery dates, and it was previously unreachable by any test.

## Variant selection is client-owned

The decision the PDP's caching rests on (plan §4.3). The server always renders the
default variant, so **the shell is 100% static for guests**. Selection changes
call a Server Function that reads the *same* cached price and inventory
entries, then `replaceState` keeps the URL shareable — no router transition, no
re-render.

Consequences worth naming:

- A shopper cycling options warms entries every other shopper then hits.
- A deep-linked variant paints the default first and reconciles during
  hydration. BigCommerce canonicalizes variant URLs to the base product, so
  nothing is lost for SEO.
- `variantDefining` replaces Catalyst's `persist` flag. The distinction that
  matters is whether an option changes price/stock/imagery — text, textarea,
  number, and date fields never do, so they never trigger a variant lookup.

## Cache Components constraint found

**`generateStaticParams` must return at least one result.**

```
Error: When using Cache Components, all `generateStaticParams` functions must
return at least one result. This is to ensure that we can perform build-time
validation that there is no other dynamic accesses that would cause a runtime
error.
```

This invalidated the documented "set `STATIC_PARAMS_LIMIT=0` to disable
prerendering" for categories, brands, *and* products. All three now clamp to a
minimum of 1. `docs/scaling.md` was written before this was known — the guidance
there to set the limit low still holds, but zero is not available.

Products default to `PRODUCT_STATIC_PARAMS_LIMIT=10` — deliberately small, since
products are the one unbounded set and a post-deploy cache-warm over real top
URLs beats guessing at build time.

## Post-phase audit

An audit after the phase "finished" found five things, three of them real:

**Three unit tests were testing dead functions.** `domain/product-options.ts`
exported `defaultSelection` and `canonicalizeSelection` with tests — but the
variant selector had defined and used its *own* copy of `defaultSelection`, and
nothing called `canonicalizeSelection` at all. Tests passing against code the app
never runs is worse than no tests. Unified on the domain function; deleted the
unused one.

Unifying surfaced a **real bug**: the component sent its whole selection to
BigCommerce, so a number field's value (say a quantity of `5`) went across as if
it were an option-value id. Text values were silently dropped by a finite check,
but numbers passed straight through. `variantSelection` now filters to
variant-defining fields, with a test.

**PDP star ratings weren't gated on `showProductRating`** — only on having
reviews. Exactly the gap fixed on the PLP in Phase 2 and missed here.

**Reviews didn't paginate.** Catalyst pages 5 at a time; this fetched 5 and
stopped. Now a "load more" client island calling a Server Function — a
`?reviews_after=` param would have made the whole PDP dynamic.

`truncateBreadcrumbs`, `isSinglePage` and `EMPTY_PAGINATION` were dead on
arrival: created for structural alignment with the plan, never wired up. The
first two are now used (deep breadcrumb trails elide the middle; pagination uses
the predicate); the third was deleted.

## Deferred

- ~~**Add to cart**~~ — landed in Phase 4.
- **Wishlist**, **review submission** — both write paths needing auth or reCAPTCHA.
- **Personalized price** (Phase 6) — the overlay described in plan §3.2.
- ~~**Quantity stepper.**~~ Landed in Phase 4, and it now drives
  `toBackorderDisplay` **client-side**: the snapshot carries raw availability
  rather than derived display state, so changing quantity recomputes the
  ship-now/backordered split with no server round trip.
- **Product analytics** (`navigation.productViewed`) — Phase 7.

## Second audit (after user-reported UI bugs)

Four more, three found by the user looking at the page:

- **Selecting an option dimmed everything**, including the control just clicked —
  which reads as "that didn't register" when the selection had already updated.
  It also flashed, since the snapshot is normally a warm cache hit at 10–30ms.
  Now only price and stock dim, behind a 200ms CSS transition delay so fast
  responses show nothing at all.
- **The active thumbnail's ring was clipped top and bottom.** `overflow-x-auto`
  makes a container clip on *both* axes, and the ring sits 4px outside the button
  (`ring-2` + `ring-offset-2`) with no vertical padding to sit in. Fixing it
  surfaced a latent one: Tailwind's `ring-offset` defaults to **white**, which
  would have drawn a white halo in dark mode.
- **Thumbnails didn't scroll into view on selection.** With 9 images you could
  select one that stayed off-screen. It's a scroll strip rather than a carousel —
  deliberately, since thumbnails are a picker — but selection now calls
  `scrollIntoView`, checking `prefers-reduced-motion` in JS because the
  `behavior` option overrides the CSS rule in globals.css.
- **`toOutOfStockMessage` was dead with 3 passing tests**, its logic duplicated
  inline in two places. The *same* defect as `defaultSelection` in the first
  audit, reintroduced within the hour. Both call sites now use the tested
  function.

`clampPage` and `MAX_PAGE_DEPTH` were also dead, and the canonicalization docs
claimed a rule that wasn't enforced: cursors are opaque, so there is no page
number to cap. Removed, and the rule reworded to describe what actually happens.
`shouldBypassCache` is what bounds deep pagination's cache impact.

## Unverifiable on this store

Store settings are `stockLevelDisplay: DONT_SHOW` and
`showOutOfStockMessage: false`, so the availability block renders empty — correct
behavior, but no stock-display path ever runs here. Max reviews on any product is
2 against a page size of 5, so the reviews load-more is unreachable. Both are
covered by unit tests; neither has run against real data.

## Known suppression

`ui/patterns/purchase-form.tsx` (named `variant-selector.tsx` until Phase 4 gave
it the add-to-cart form) disables `react-hooks/set-state-in-effect` for
one effect, with the reasoning inline. The rule catches derived state; this is
fetching external data in response to mount-time browser state, which it cannot
distinguish. Both alternatives are worse — deriving from `useSearchParams` during
render fixes the buttons but shows the wrong price on deep links, and reading on
the server makes every PDP dynamic.

Note `eslint --fix` **strips** disable comments it judges unused, which silently
reintroduced this error once. Don't run it blindly on files carrying justified
suppressions.

## Systematic audit (pass 1–5)

After three rounds of "anything else?" each turning up something, the ad-hoc
checks were replaced with a scripted sweep across issue classes, run repeatedly
until two consecutive passes came back clean. What it found:

**Unsanitized merchant HTML — the significant one.** Product descriptions,
warranties, and category blurbs were rendered raw through
`dangerouslySetInnerHTML`. That content is authored in the BigCommerce control
panel, so a compromised merchant account — or a staff user with catalog access
and no business injecting scripts — could execute arbitrary JS on the storefront.
On an ecommerce site that means session theft or a card skimmer. Catalyst runs
DOMPurify for exactly this reason. Now sanitized through an allow-list in
`domain/html.ts`, applied inside `data/` so the *safe* HTML is what gets cached.

**Broken images in merchant content.** The WYSIWYG editor stores uploads as
store-root-relative WebDAV paths (`/content/…`, `/product_images/…`) that resolve
on a same-domain Stencil storefront and 404 headlessly. Ported Catalyst's URL
rewriting, scoped to those two folders so ordinary page links are untouched.

**The i18n seam existed but was unused.** `lib/i18n/messages.ts` was built in
Phase 1 specifically so copy wouldn't be hardcoded and Phase 8 could be a config
change — then 33 strings were hardcoded across every component anyway. All of it
now routes through `messages/en.json` (73 keys, 81 call sites, zero literal
`aria-label`/`placeholder`). This also moved CTA labels and stock phrasing *out*
of `domain/availability.ts`: the domain returns a `kind` and a number, the UI
supplies the words.

**No error boundaries.** `app/global-error.tsx` and `app/(storefront)/error.tsx`
were both absent, so any thrown error showed Next's default page. The storefront
one is scoped to the route group, so header and footer survive an error in the
page body.

**`graphql` was a runtime dependency** but is only a peer of the codegen CLI —
moved to devDependencies. `shellProfiles` was dead and removed.

The audit script lives in the session scratchpad; the classes worth re-running
each phase are: dead exports, duplicated domain logic, unresolved `t()` keys,
unsanitized HTML, missing error boundaries, and unused dependencies.
