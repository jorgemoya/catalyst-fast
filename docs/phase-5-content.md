# Phase 5 — search, content, SEO

## Result

| Route | Cold calls | Warm (×6) | Warm latency |
| --- | --- | --- | --- |
| `/search/?term=plant` | 7 | **0** | 15ms |
| `/blog/` | 2 | **0** | 11ms |
| Blog post (vanity URL) | 2 | **0** | 8ms |
| `/blog/?tag=SEO` | 2 | **0** | — |
| `/robots.txt` | **0** | **0** | 0.9ms |
| `/sitemap.xml` | **0** | **0** | 0.7ms |

`robots.txt` and `sitemap.xml` cost nothing even cold: both build as `○ (Static)`,
so the build already paid for them. Everything else holds the project line —
**zero warm origin calls**.

55 e2e passing, 208 unit tests, build clean. Re-verified after a channel switch — see the section at the end.

## Search reuses the listing stack, with one deliberate difference

A search *is* a faceted listing whose key carries a `term` instead of a
`categoryId`, so `/search` gets facets, sort, and cursor pagination for free. That
reuse is the payoff for keying `searchListing` on a canonical `ListingKey` rather
than writing per-page query functions.

The difference is `prerenderDefault={false}`, a new opt-out on the listing
regions. Category and brand render their *unfiltered* listing inside the Suspense
fallback so the prerendered shell holds real products. **On search that would be
actively wrong**: a search key with no term is the entire catalog, so the fallback
would flash the whole store before results replaced it — and spend a full
`SearchProducts` query doing it. A search page has no static shell to fill anyway;
it cannot render without reading `term`.

For the same reason `SearchResults` short-circuits before touching BigCommerce
when the term is empty. An empty search is not "a search with zero results".

`/search` is `noindex, follow`. Search pages are the classic crawl-budget sink —
unbounded URL space, thin duplicated content, no canonical of their own. Category
pages are the indexable surface.

## Quick search shares the results-page cache

The header island fetches suggestions through a Server Function that calls
`searchListing` with `limit: DEFAULT_LIMIT` — **not** the five it displays. That
produces the identical cache key the results page will use, so typing a term warms
the page the shopper is about to open, and two shoppers searching "plant" share one
origin request. Trimming to five happens after the cache, where it costs nothing.

It is its own island, mounted independently of the nav and cart badge. Catalyst
folded search, the mega-menu, locale and currency switchers, and the mobile drawer
into one 1056-line client component, so a shopper who never opened search still
downloaded and hydrated all of it.

## One render site for merchant HTML

`dangerouslySetInnerHTML` for merchant content now appears in exactly **one**
place, `ui/patterns/prose.tsx`. It was three (PDP description, PDP warranty,
category description) and Phase 5 would have added three more (web page body,
contact body, post body).

That is a security posture, not tidiness: the repo audit had several sites to
check and each new one was a chance to forget `toSafeHtml`. With one component the
invariant is greppable, and sanitization stays a property of the data layer —
every `htmlBody` in `data/content.ts` goes through `toSafeHtml` inside the cached
read, so the *safe* HTML is what gets stored.

## Bugs found

**The blog index was empty on the untagged view.** `filters: { tags: [$tag] }` with
a null `$tag` becomes `tags: [null]`, which BigCommerce reads as "posts whose tag
is null" — zero results, no error. Now `filters` is `null` when untagged. Caught by
an e2e assertion on the post list, not by types: the query was valid, the answer
was wrong.

**`'use server'` modules may export only async functions.** Exporting
`MIN_QUERY_LENGTH` and the `Suggestion` type alongside the action made the module
compile to *no exports at all*, and it failed at the importing file with "export
not found" rather than at the source. The constant and type moved to
`domain/suggestions.ts`. This is the second time the rule bit — arrow constants
returning a promise didn't qualify in `_actions/discounts.ts` — so it is now
recorded on both modules.

**Clearing suggestions in an effect was derived state.** React's lint caught a
synchronous `setState` in an effect; whether to show the list is now computed
during render. Fixing it surfaced a real bug the lint did *not* catch: the debounce
cleared the pending *timer* but not an in-flight request, so a response for an
older term could land after a faster one for a newer term and overwrite it. Guarded
with an `ignore` flag.

## The build failure worth keeping

A build failed with `Export encountered an error on /search` — which looked like a
code defect and was not. The cause was `UND_ERR_CONNECT_TIMEOUT`: a single TCP
connect to BigCommerce timed out during prerendering.

**The client did not retry it.** `isRetryableStatus` only sees *responses*; a
`fetch` that never gets one throws instead, straight past the retry loop. So one
flaky connection had the final say over a deploy, with no retry anywhere — page
prerendering has none of its own.

`isRetryableNetworkError` now retries transport failures (connect/header/body
timeouts, `ECONNRESET`, transient DNS) with the same jittered backoff as 429s, and
deliberately **not** `AbortError`, which was cancelled on purpose. It matters most
exactly when it is most likely: a cold deploy fires every cache miss at
BigCommerce at once, which is when connections are most apt to time out.

The concurrency controls now have tests at all — semaphore limits, coalescing,
jitter, `Retry-After` capping, and the cause-chain walk. They were written in
Phase 0 and had never been exercised.

## Second pass: plan-coverage gaps

The scripted audit checks code hygiene, not whether the phase actually built what
Part 1 of the plan describes. Re-reading the inventory against the code found four
gaps, one of them a bug predating this phase.

**`defaultSearchProductSort` was ignored — and it turned up an older bug.** The
plan calls for it explicitly ("`defaultSearchProductSort` for search"); `/search`
passed no `defaultSort` at all, so it fell back to `featured`. That is
cache-relevant, not cosmetic: canonicalization drops a `?sort=` equal to the
default, so a shopper picking the option that *is* the default was creating a
second entry identical to the unsorted one.

Wiring it meant mapping BigCommerce's sort enum, which `data/catalog.ts` already
did for categories — and that map was **wrong**. It keyed on `ALPHABETICAL_ASC` /
`ALPHABETICAL_DESC`, which are not members of `CategoryProductSort`; the real
values are `A_TO_Z` / `Z_TO_A`, which were absent. So an alphabetically-sorted
category silently had *no* recognized default and never collapsed `?sort=a-to-z`
onto its unfiltered entry. Shipped in Phase 2, survived three audits, found only
by reading the schema while adding the search equivalent.

Both now share `fromBcSort` in `domain/listing-params.ts`, with tests naming the
old wrong keys so they cannot come back. `DEFAULT` correctly maps to `undefined` —
"the merchant chose nothing" is not a sort value.

**Blog posts and web pages were reachable at their rewrite targets.**
`INTERNAL_ROUTE_ONLY` covered `category|brand|product` but not `/blog/1` or
`/webpages/{id}/normal`, so the same content was served at a second,
non-canonical URL — and because `notFound()` cannot set a status after a PPR shell
flushes, it would have been a **200** for a crawler to index. The guard now covers
both, verified against thirteen paths including the ones it must *not* catch
(`/blog`, `/your-first-blog-post/`).

**The search term was missing from the document title.** The plan asks for it
("term interpolated into title and empty state") and only the empty state had it.
It now goes in `generateMetadata` and deliberately *not* in the `<h1>`, which sits
in the static shell — making the heading term-dependent would pull it and the
search field out of the prerender for a value the browser already has.

**The blog index had no canonical.** Now points at the merchant's blog path, and
`?tag=` views point there too rather than at themselves: a tag view is a thin
filtered slice, and self-canonicalizing would ask a crawler to index one page per
tag.

### Checked and found correct

Breadcrumb truncation is applied (`ui/patterns/breadcrumbs.tsx` uses
`truncateBreadcrumbs`). `defaultKey` preserves `term`, so the facet "all options"
read on a search resolves against the same term rather than the whole catalog.
`RawHtmlPage` is handled in the proxy and never reaches a Next route.

### Still missing, deliberately

The plan's web-page inventory mentions a **sibling-nav sidebar** (Catalyst has a
`webpages/[id]/layout.tsx` listing pages at the same level). Not built: the
storefront API has no cheap way to enumerate a page's siblings, and this store has
no web pages at all to design against. Worth revisiting on a store that uses them.

## Deferred

- **reCAPTCHA on the contact form.** Worth stating plainly rather than leaving
  implicit: **that endpoint is currently unprotected**, and a public contact form
  without spam protection will be found. BigCommerce accepts an optional
  `reCaptchaV2` argument on `submitContactUs`, so wiring it in Phase 7 is additive.
- **Blog pagination is next-only.** Cursor pagination has no page numbers, and the
  index has one "next" link rather than a full pager. Fine for a blog; the PLP's
  bidirectional pager is the model if it needs more.
- **`RawHtmlPage`** already worked — the proxy returns the merchant's HTML
  directly and it never reaches a Next route, so there was nothing to build.

## Verified after a channel switch — and it found a real bug

The connected channel changed to "Catalyst Canary", which has the content the
previous one lacked: a `NormalPage`, a `ContactPage` with all five optional
fields enabled, a swatch/dropdown product, and an out-of-stock product. Every
route this phase added has now run against real data.

**The channel switch immediately exposed a latent bug in the web-page routes.**
Node ids are base64 of `Type:entityId`, and base64 emits `=` padding only when
the input length is not a multiple of three:

```
NormalPage:1   → Tm9ybWFsUGFnZTox      no padding
ContactPage:4  → Q29udGFjdFBhZ2U6NA==  padded
```

`=` is not path-safe, so building the rewrite URL percent-encoded it and the page
received `Q29udGFjdFBhZ2U6NA%3D%3D`, which BigCommerce rejects with
`Invalid Global ID`. **`/shipping-returns/` worked and `/contact-us/` did not** —
and which pages work depends entirely on the byte length of their type and id,
so a store could look completely healthy until a merchant adds one more page.

`decodeNodeId` fixes it, applied *before* the cached read so the encoded and
decoded spellings can't become two cache keys for one page. Four unit tests,
including the idempotence that lets it be applied unconditionally.

This is the strongest argument in the project so far for testing against more
than one store: the previous channel had no web pages at all, so nothing about
this was reachable.

## Store-specific paths are now in one file

Switching channels invalidated every hard-coded vanity URL across four spec
files. They now live in `e2e/fixtures.ts`, so a channel change is a single edit,
and it is obvious at a glance which assertions depend on the store rather than on
this codebase.

## Still unverifiable

No product on this channel sets `minPurchaseQuantity > 1`, `maxPurchaseQuantity`,
or finite stock — queried to confirm, not assumed. So the quantity bounds and the
BigCommerce-rejection handling behind them remain unit-tested only, as on the
previous channel.

**A successful contact submission is deliberately not tested end to end.** It
sends a real email to the merchant's inbox, which a test suite should not do to a
live store on every run. The browser blocks an invalid address before the action
runs (`type="email" required`), which is what the e2e asserts; the server schema —
the guard that actually matters, since a crafted POST bypasses the browser — is
covered by `domain/contact.spec.ts`.

The blog still has one post, so pagination past the first page is unexercised.
