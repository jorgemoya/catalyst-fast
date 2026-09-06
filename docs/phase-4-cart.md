# Phase 4 — cart + checkout handoff

## Result

A guest can go home → listing → product → cart → BigCommerce checkout with no
account and no sign-in prompt.

| | |
| --- | --- |
| Guest with no cart, any page | **0 BigCommerce calls**, 10–15ms warm |
| Guest with a cart, first page view after a change | **1 call** (`CartCount`), 250–290ms |
| Guest with a cart, every page view after that | **0 calls**, 10–12ms warm |
| Home shell | 12 product cards, unchanged from Phase 1 |
| PDP shell | title, gallery, price, stock, CTA — unchanged from Phase 3 |
| E2E | 34 passed, 1 skipped |

The badge costs one origin call per cart mutation, not one per pageview. Catalyst
fetched the same number with `cache: 'no-store'` on **every request of every
page**, for logged-in and guest traffic alike.

## The `updateTag` + `refresh()` contract

Phase 4's real deliverable, and the thing most likely to be broken later by
someone tidying up.

The badge is a `'use cache: private'` scope. Private scopes may read cookies —
which is the only reason the badge can resolve *which* cart is this browser's —
and in exchange are **never stored on the server**. They live in the browser's
memory. So `updateTag` cannot reach one:

```ts
// lib/cart/revalidate.ts
export function revalidateCart(cartId: string): void {
  updateTag(tags.cart(cartId));  // expires getCart + getCartCount on the server
  refresh();                     // re-renders dynamic holes, incl. the private badge
}
```

Delete the `refresh()` and everything still *looks* fine: the cart page updates,
the badge catches up on the next navigation, and any test that asserts on the
cart page passes. The failure is visible in exactly one place, so that is where
the test is:

```
e2e/cart.spec.ts › add to cart › updates the header badge on the FIRST click
```

## What the badge cost the static shell

Every storefront route moved from `○ (Static)` to `◐ (Partial Prerender)`.

That is the correct trade and worth stating plainly, because Phase 1's headline
was "`/` is 100% static". It no longer is — the header now contains one
per-visitor value, and a private scope is excluded from shell generation by
construction. What did **not** change is the page content: home still prerenders
12 product cards, the PDP shell still carries title, gallery, price, stock and a
functional CTA, and warm requests still serve in 10–15ms with
`x-nextjs-prerender: 1`. The `x-nextjs-postponed: 1` header is the one streamed
hole.

`cacheLife('cart')` puts the badge's `stale` at 30s — exactly
`MIN_PREFETCHABLE_STALE` — so it stays in prefetches rather than dropping out of
them.

## Two caches, nested

```
CartBadge
└─ getBadgeCount()      'use cache: private'   ← reads the cookie. Never server-stored.
   └─ getCartCount(id)  'use cache: remote'    ← keyed by cart id. Shared, durable.
```

Nesting a public cache inside a private one is the sanctioned pattern, and it is
what makes the numbers above work: the *identifying* half can't be cached
server-side, but the *expensive* half — the BigCommerce round trip — can.

`getCartCount` is deliberately its own query rather than a field read off
`getCart`. The badge renders on every page of the site; reusing the full cart read
would drag every line item, option, and price through the cache to display one
integer. Both carry `tags.cart(cartId)`, so one `updateTag` still invalidates them
together.

## Guest identity without next-auth

The whole of a guest's cart state is one BigCommerce cart id in one `httpOnly`
cookie (`lib/cart/session.ts`). Catalyst wraps the same id in a next-auth JWT.

**That signature is not a security control**, and it's worth saying why rather
than cargo-culting it: the cart id *is* the capability — anyone holding it can
read and mutate that cart, and BigCommerce itself puts it in the hosted-checkout
URL. A signature would only certify that we issued the value. An attacker
mounting cart fixation would simply obtain a legitimately-issued id for their own
cart first. What actually protects the cookie is `httpOnly` (script can't read it)
and `sameSite: 'lax'` (a cross-site post can't act on it).

Skipping the JWT keeps next-auth out of the guest path entirely, which is the
point of building guest-first. Phase 6 moves the id onto the auth session; all
three functions in `session.ts` are the seam.

## Security: the form is rebuilt from the catalog, never trusted

Both write paths re-derive what they need server-side:

- **Add to cart** rebuilds the zod schema from `getProduct(id).options` — a cached
  read, so it costs nothing — and sorts values into BigCommerce's six per-kind
  lists by the option's *declared type*. A submitted value can only ever be
  interpreted as the kind of option the catalog says it is. This makes the Phase 3
  regression (a number field's value sent as an option-value id) structurally
  impossible rather than filtered out.
- **Quantity update** takes only the line id from the form and re-reads the
  product, variant, and selected options from the cached cart. Had those come
  from hidden inputs, anyone could rewrite a line into a different product at the
  old price.

## Bugs found while building

**The injected `required` message was silently discarded.** `purchaseSchema` takes
its copy as an argument specifically so `domain/` stays translatable, and
`z.preprocess(fn, schema, params)` ignores the `params` message — every required
field reported zod's own untranslatable `"Required"`. Caught by a unit test that
asserts on a fixture message rather than English. Fixed by making every field
optional at the schema level and enforcing required with a `refine`.

**`/cart` and `/checkout` were resolvable against BigCommerce.** The proxy
resolves the merchant's URL space, and nothing stops a merchant creating a web
page at `/cart/`. On such a store the proxy would have rewritten to `/webpages/…`
and made our cart unreachable — a failure that appears on *some* stores only.
`APP_OWNED_PATH` in `with-routes.ts` short-circuits both before resolution.

**The cache audit fired on prose.** `\bmutate\b` matched the phrase "read and
mutate that cart" in a comment. An audit that fires on prose gets silenced rather
than fixed, so the pattern now matches a call or an import.

**`trailingSlash` hides the checkout handler.** A raw `GET /checkout` is a 308 to
`/checkout/` and never reaches the route handler. Only visible because the e2e
test asserts the status with `maxRedirects: 0`.

## Post-phase audit

Run as a script across the whole repo, to two consecutive clean passes.

**BigCommerce rejections were hitting the error boundary — the significant one.**
Every cart action caught `CartError` and rethrew everything else. But `CartError`
is only raised when a mutation returns a null cart; BigCommerce reports actual
*rejections* — over-max quantity, insufficient stock, an unresolvable variant — as
a 200 with a GraphQL `errors` array. So an ordinary shopper mistake escaped the
action and produced a full-page "Something went wrong" instead of a sentence next
to the button. `toSubmissionErrorMessage` now maps `BigCommerceGQLError` onto the
form and rethrows everything else, with the narrowness deliberate: an HTTP
failure, a timeout, or an auth error is a genuine fault and must stay visible
rather than being reported to every shopper as a bad code.

**That fix then introduced an i18n regression, caught by verifying the change
rather than assuming it.** Passing BigCommerce's message through verbatim puts an
English string on the page that bypasses `messages/en.json` — exactly the debt
Phase 8 exists to avoid. Measured live, its invalid-coupon copy is
`Incorrect or mismatch: Coupon code \`X\` is invalid`, which is no more
informative than ours and less well written. So the rule is now split: our
translatable copy wins for rejected coupons and gift certificates, BigCommerce's
wins where its message carries a number we never fetched ("only 2 available").

**`createKVAdapter`'s comment claimed "Exported for tests" and no tests existed.**
A false justification is worse than an unexplained export. Now covered — the
priority order (Vercel → Cloudflare → Upstash → memory) has a silent,
deploy-shaped failure mode: pick wrong and route resolution still *works*, it just
stops being shared across instances, degrading to nothing on exactly the traffic
KV exists to absorb. The tests also confirm a half-configured Upstash (URL, no
token) falls back to memory rather than constructing a client that throws on
first use.

`BcSort` and `CacheProfileName` were dead type aliases and were removed.

**Checked and clean:** message keys (no missing or unused), hardcoded
`aria-label`/`placeholder`/`alt` copy (none), error boundaries, unused
dependencies, dead exports, cart mutations missing `revalidateCart`, and
`console.log` without a logger gate — all five call sites are gated behind
`*_LOGGER`.

**Sanitization coverage re-verified.** Product description and warranty
(`data/product.ts`) and category description (`data/catalog.ts`) all route through
`toSafeHtml`. Brand pages render no merchant HTML at all — `BrandPage` has no
`description` field, so there is no gap there, though it is a small parity gap
against Catalyst, which does show brand descriptions.

## Caching health check (measured after the phase)

Prompted by "are we still highly cacheable?" — measured rather than asserted, and
it turned up one real defect.

**Tracking parameters were defeating the proxy's route cache.** The KV key was
`pathname + search`, so `?fbclid=…` — which is **unique per ad click** — made
every visitor from a campaign a guaranteed miss, paying a blocking `site.route`
round trip before Next could even route the request, on every page they visited.
Measured: five `fbclid` values against one path produced five `GetRouteQuery`
calls; the same value repeated produced one.

That is origin QPS scaling with *traffic* — the exact failure this rewrite exists
to remove — and it was hiding one layer below `domain/listing-params.ts`, which
already canonicalizes for the *data* cache. The data layer was immune; the proxy
was not.

`toRouteKeyPath` in the new `proxies/route-key.ts` strips known marketing
parameters and sorts the rest, for both the KV key and the `site.route` lookup —
they must be derived from the same string, or two different URLs could share an
entry and a redirect meant for one would fire on the other. After the fix, six
unique `fbclid`+`utm_campaign` combinations on a warm path cost **0** calls.

The extraction also gave `normalizeForCompare` and `sameInternalUrl` their first
tests. Both were documented as "load-bearing against redirect loops" and had
none, because `with-routes.ts` imports `server-only` and cannot be unit-tested;
`vitest.config.ts` now includes `proxies/`.

**The self-hosted `use cache: remote` path had never worked.** Following up on
"this measures the in-memory fallback, not a real remote handler", building with
`CACHE_HANDLER=kv` failed outright — and fixing it uncovered four separate
defects, none of which could have been caught without running it:

1. `~/lib/kv` did not resolve. Next loads a cache handler **outside the normal
   module graph**, so tsconfig `paths` do not apply.
2. Relative imports still failed: the loader does no directory or extension
   resolution, so every import in the subtree needs an explicit `.ts`
   (hence `allowImportingTsExtensions` in tsconfig).
3. The loader is Node's **type-stripping** mode, which only accepts erasable
   TypeScript. Two constructor parameter properties in `lib/kv` failed with
   `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`.
4. **The one that mattered most.** With the build finally green, the handler
   still never loaded: at runtime Next resolved the project-relative path against
   `distDir` and looked for `.next/lib/cache/handlers/kv.ts`. The resulting
   `ERR_MODULE_NOT_FOUND` was swallowed as an unhandled rejection and Next
   **silently fell back to the default in-memory handler** — build green, pages
   cached, warm requests at 0 calls, and a self-hosted deployment with no shared
   cache at all. The only evidence was one line in the startup log. The path is
   now absolute, via `fileURLToPath`.

Verified working: 0 module errors, 564 `nc:entry:` / `nc:tag:` key operations
against the KV layer, cold 19 calls and **warm 24 requests → 0 calls** — matching
the default handler exactly.

Anyone self-hosting should run one `CACHE_HANDLER=kv` build and check the startup
log for `ERR_MODULE_NOT_FOUND`, because a broken handler here fails silently by
design.

**Result: 70 warm requests across every route type, 0 BigCommerce calls, 6–13ms.**
Full table in `docs/measuring.md`. The remaining caveat is that even with the KV
handler, a local run uses `MemoryKvAdapter` — so cross-*instance* sharing still
needs a deployment with Upstash or Cloudflare KV configured to demonstrate.

## Found, not fixed — outside this phase

**The unfiltered listing page serializes its grid twice.** `/shop-all/` returns 24
`<article>` elements for 18 products, and the `result-count` element appears
twice in the HTML. This is the nested-Suspense trick from plan §4.4 — the default
grid renders inside the fallback so it lands in the static shell, *and* again as
the streamed content — so on the unfiltered view the two are identical and one is
pure waste on the highest-traffic listing view.

It also has a test-visible symptom: mid-stream both copies are in the DOM with one
marked hidden, so `page.locator('article').first()` can latch onto a card that
never becomes clickable. `e2e/cart.spec.ts` filters on `visible: true` and says
why.

**A claim that it costs an extra query per filtered view was wrong**, and is
worth recording as a correction. Measured with valid sort values, each distinct
filter costs exactly one `SearchProducts`:

| Cold request | `SearchProducts` |
| --- | --- |
| `/shop-all/` | 1 |
| `?sort=price-asc` | 1 |
| `?sort=a-to-z` | 1 |
| `?sort=best-selling` | 1 |
| `?sort=price-asc` again | **0** |
| `?sort=price-asc&utm_source=x&junk=1` | **0** |

The observation behind the wrong claim was a single request cold-missing *two
different keys* — the default (for the shell's fallback) and the filtered one —
because that route's shell had not been generated yet in that session. Once the
default key exists, which the unfiltered view most traffic hits populates anyway,
a filtered view costs only its own query.

The last row is worth noting on its own: appending unknown and tracking
parameters to an already-cached key still hits, which is `domain/listing-params.ts`
doing its job.

So the remaining cost is **payload, not origin calls** — the duplicated markup.

This is Phase 2 design, not Phase 4 work, and fixing it means revisiting whether
the nested fallback earns its cost. Measure the payload delta before changing it.

## Deferred

- **Shipping estimator.** Needs `GeographyFragment`, the US duplicate-abbreviation
  blacklist, and consignment handling. The summary deliberately shows a subtotal
  and no "Total including shipping" rather than a number that later grows.
- **Wallet buttons** (express checkout) — needs the `/graphql` proxy allow-listed
  for `checkout-sdk-js`. Phase 7.
- **Gift certificate *purchase*** — the cart renders and removes gift-certificate
  line items, but the purchase form is its own phase.
- **Cart analytics** (`cartViewed`, `productAdded`, `productRemoved`) — Phase 7,
  with the consent manager. `createCartRedirectUrls` accepts an optional
  `analytics` input; omitting it costs attribution, not correctness.
- **`defineAction` wrapper** (plan §4.7). Deliberately skipped: without
  `server-toast` the uniform "parse → handle → invalidate → toast" shape is half a
  wrapper, and six actions with genuinely different signatures don't yet justify
  one. `revalidateCart` covers the part that actually repeats.
- **Customer-assigned carts.** Every mutation here is guest-path and carries the
  store token. Once a cart is assigned to a signed-in customer the same mutations
  need that customer's token via `customerQuery` — the shapes don't change, only
  the fetcher. Phase 6.

## Unverifiable on this store

No product on the demo store has a partial backorder, so `CartLineStock`'s
ready-to-ship/backordered split renders in unit tests only. Same for
gift-certificate line items and for a *valid* coupon — the invalid path is covered
end to end, the success path is not.

Queried directly to confirm rather than assumed: **no product on this store sets
`minPurchaseQuantity > 1`, `maxPurchaseQuantity`, or finite stock.** So the
quantity-limit paths — the stepper's bounds, the schema's min/max, and the
BigCommerce-rejection handling that replaced the error boundary — cannot be
triggered here at all. They are unit-tested; none has run against real data.
