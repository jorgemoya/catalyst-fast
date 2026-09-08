# Phase 6 — auth, accounts, personalized pricing

## The bar, and whether it was met

> *"A logged-in user's PDP serves the same static shell as a guest's — only the
> price overlay and account chrome differ. Target ≤2 origin requests vs.
> Catalyst's ~7."*

**Structurally met; only half of it is measured.** A signed-in shopper's page
differs from a guest's in exactly three places, all `'use cache: private'` scopes
behind their own Suspense boundaries:

| Hole | Origin cost when signed in |
| --- | --- |
| Account menu | **0** — the name is already on the session from login |
| Cart badge | 0 warm (unchanged from Phase 4) |
| Wishlist heart | 0 extra — derived from the same wishlists read the account page uses |
| Price overlay | **0** for default-group customers; 1 otherwise |

Everything else — title, gallery, price, stock, CTA, specs, description, reviews,
related products — is the same prerendered shell both audiences receive.

Measured, guest-side, after adding all of it:

| | Calls |
| --- | --- |
| Guest PDP ×8 warm | **0** |
| Guest home ×8 warm | **0** |
| PDP shell still contains price + CTA | yes |
| Warm latency | 9–10ms |

**What is not measured: the signed-in path.** The connected store has no test
customer, so a successful login has never run. See "Unverified" below — this is
the largest open item in the phase and I am not claiming otherwise.

## The design decision the plan got wrong

The plan said the cart id would move onto the auth session in this phase. **It
didn't, and shouldn't.**

BigCommerce merges the guest cart itself when `login` is given
`guestCartEntityId`, returning the resulting cart. So all that is needed is to
write that id back to the same `cf.cart` cookie Phase 4 already uses. The cart id
therefore has **one home** for guests and customers alike, `getCartId()` is
unchanged, and there is no second copy on the session to disagree with it.

Catalyst puts the cart id on the session because it had no separate cookie to put
it in. Copying that here would have imported the constraint without the reason.

## Auth is optional infrastructure

Without `AUTH_SECRET` the storefront runs exactly as it did through Phase 5 —
browsing, cart, and checkout unaffected — and only account features go dark.
`getSession()` short-circuits to `null` before touching next-auth.

This isn't hypothetical robustness: the connected store had no `AUTH_SECRET`
throughout most of this phase's development, and every measurement above was taken
in that state. A missing secret must not take down a store that never enabled
accounts, and `null` is a state every consumer already handles for signed-out
visitors.

## Why next-auth here but not in Phase 4

Phase 4 deliberately built guest identity **without** next-auth, and this phase
adds it. Both are right, for the same reason:

- The **guest cart cookie** holds an unguessable id that *is* the capability.
  Signing it certifies nothing an attacker couldn't obtain legitimately, so it
  gets `httpOnly` + `sameSite` and no crypto.
- The **session** holds a `customerAccessToken` — a real credential. next-auth's
  encrypted JWT keeps it unreadable in the cookie. Session crypto is the one part
  of this project genuinely not worth hand-rolling.

## Personalized pricing: the gate is the whole design

BigCommerce resolves `prices(...)` against the *identity of the requester* — there
is no `customerGroupId` argument to key a cache on — and Next stores cache keys in
plain text, so a customer token can never appear in one. Personalized prices are
therefore not server-cacheable, full stop.

What makes that acceptable is who actually pays for it:

```
guests                        → 0 fetches; price is in the prerendered shell
signed-in, default group      → 0 fetches; their price IS the catalog price
signed-in, non-default group  → 1 small query in a Suspense hole
```

The middle line is most signed-in traffic on most stores, and it is only possible
because `customerGroupId` is captured on the session at login — which is why both
login mutations select it. Catalyst, by contrast, flipped *every* query on the
page to `no-store` the moment a customer token existed.

A stale display price is a UX defect, never a revenue defect: BigCommerce
recomputes at add-to-cart and again at checkout. Never derive a cart total from a
cached price.

## The proxy's authenticated fallback (§6.3), measured

Catalyst had *any* request carrying a customer token skip the route cache
entirely — a synchronous GraphQL round trip before the route was even known, on
every page, for every logged-in and B2B shopper. It is one of the three structural
reasons this rewrite exists.

The case behind it is real, though: a product restricted to a customer group
resolves to `null` for guests, so sharing that cached "not found" would 404 the
customers who *can* see it. So the re-resolution now fires only where it could
change the answer — the cached result is negative **and** a session cookie is
present:

| Request to a not-found path, ×3 | `GetRouteQuery` calls |
| --- | --- |
| No session cookie | **0** (cached negative, shared) |
| With a session cookie | **3** (one re-resolve each) |

The proxy matches the cookie by *presence* only. Decoding it would mean shipping
the auth secret into middleware and paying a decrypt on every request to answer
"might this shopper be signed in?". The authenticated result is deliberately never
written back to KV — it is true for one customer group, not for the store.

Note it is re-resolved per request rather than cached. That is the correct
trade — a not-found path is rare — but it is not free, and a signed-in shopper
hammering a 404 pays each time.

## Verified

- Signed-out `/account/*` redirects to `/login?redirectTo=…`, from the **layout**
  so a section added later inherits the guard rather than forgetting it
- Bad credentials rejected with **no session cookie set**, and without saying
  which field was wrong — distinguishing them tells an attacker which addresses
  are registered
- Both providers (`password`, `jwt`) registered; `/api/auth/{session,csrf,providers}`
  all healthy with a secret set
- Guest PDP wishlist renders a **sign-in link carrying the product path**, not a
  button that fails
- No price overlay for guests — the cached price stands
- `safeRedirectPath` rejects absolute, protocol-relative (`//evil.test`),
  backslash-escaped, and control-character redirect targets (6 unit tests)

`trailingSlash: true` 308-redirects next-auth's own non-slash URLs. It does not
affect the login path — the action calls `signIn()` server-side, which invokes the
provider directly rather than over HTTP — and the endpoints work fine when
requested with the slash. Worth knowing before adding any client-side `signIn()`.

## Unverified — the honest gap

**No successful login has ever run.** The store has no test customer, so
everything downstream of authentication is unexercised against real data:

- the cart merge (`guestCartEntityId` → returned cart id)
- the signed-in PDP shell, and therefore the headline bar's second half
- the price overlay actually rendering for a non-default group
- account orders, addresses, settings, and wishlists with real records
- `customerGroupId` arriving on the session at all

The plumbing is typed, linted, and structurally verified; none of it is proven.
A single test customer on the connected channel would close most of this in one
pass.

## Completed in the follow-up pass

Everything previously deferred, except the two items below:

- **Register** — form, schema, and action, then an immediate `signIn` so the new
  customer lands authenticated with their guest cart merged. Registering without
  that leaves a shopper with an account they can't see.
- **Forgot password / reset password** — the request form **always reports
  success**, whether or not the address is registered, and the action swallows
  failures for the same reason: distinguishing them turns the form into an oracle
  for which addresses exist on the store. The reset route reads `?c=` and `?t=`
  from BigCommerce's emailed link; its path is set in the request mutation, and
  the two must stay in step or every link already in an inbox breaks.
- **Change password** on settings, alongside the profile form.
- **`/login/token/[token]`** — SSO and B2B impersonation. A GET, because IdPs
  redirect the browser here, which makes the token itself the credential.
  `redirect_to` is a *signed claim* rather than a query parameter, so it can't be
  tampered with — and is still run through `safeRedirectPath`, because a
  compromised IdP is exactly where an absolute URL would do most damage.
- **Address CRUD** — one form and one schema serve create and edit; the presence
  of an id decides which mutation runs, so validation messages can't drift
  between the two.
- **Wishlist CRUD** — create, rename, delete, and share. Sharing toggles
  `isPublic`, which is what makes the `token` link resolve; turning it off leaves
  the token unchanged but stops BigCommerce serving it, so a shared link goes dead
  rather than leaking.
- **PDP heart is now functional** — a popover listing the shopper's wishlists,
  each row toggling this product in or out. `itemId` being non-null is both the
  checkmark and exactly what the remove mutation needs, so un-saving requires no
  second lookup.
- **Public wishlist** at `/wishlist/[token]` — and it lives in `data/`, not
  `data/customer/`, because it is genuinely public: the token is the capability,
  like a cart id. So it is a shared cache keyed by a scalar, and two people
  opening the same link cost one origin request between them. `noindex` all the
  same — someone sharing a link did not ask to be published.
- **Order detail** — `site.order(filter:)` is scoped to the access token by
  BigCommerce, so another customer's id returns null rather than their data.

### A build failure worth recording

Wiring the wishlist popover broke the build: the client button imported
`HeartIcon` from `wishlist-toggle.tsx`, a Server Component that reaches
`data/customer/session` → `server-only`. One shared leaf icon pulled the entire
customer data layer into the client graph.

Typecheck and lint both passed — only `next build` catches it. `HeartIcon` now
lives in `ui/primitives/heart-icon.tsx` with **no imports at all**, which is the
general rule: a leaf shared across the client/server boundary must not sit in a
file that touches the server.

## Three bugs that only appeared once `AUTH_SECRET` was set

Worth recording together, because they share a cause: **auth being unconfigured
was masking them.** Every earlier green build and green suite was green partly
because `getSession()` short-circuited before doing anything.

**1. The account routes were never prerenderable.** With a secret set, `auth()`
reads `cookies()` — uncached runtime data outside a Suspense boundary — and the
build failed on `/account/addresses`. The fix is `export const instant = false` on
the account layout, and it is the correct *resting* state rather than the usual
temporary escape hatch: the layout must know whether the shopper is signed in
before it can redirect, and a redirect cannot be streamed once a shell has
flushed. There is nothing worth prerendering below it either — every page is one
customer's data end to end. The routes now correctly report `ƒ (Dynamic)`.

**2. `UntrustedHost` on every auth request.** next-auth refuses to build callback
URLs from an untrusted `Host` header — the right default, since a spoofed Host
would let an attacker redirect the sign-in flow to their own domain. It
auto-trusts on Vercel and must be opted into everywhere else. My own earlier
manual test passed only because I had set `AUTH_TRUST_HOST=true` on that one
command. **Any self-hosted deployment needs it**, and without it the failure is an
opaque `UntrustedHost` at request time rather than anything at startup — the same
shape as the `CACHE_HANDLER=kv` bug in Phase 5.

**3. `crypto.getRandomValues()` on every PDP render.** Reported from the dev
terminal, not by any check I was running:

```
Error: Route "/product/[id]": Next.js encountered the unstable value
`crypto.getRandomValues()` while prerendering.
```

`WishlistToggle` called `getSession()` directly in its component body. Being
inside a `<Suspense>` boundary is *not* sufficient — Next still attempts to
prerender that subtree, and `auth()` uses `crypto.getRandomValues()`, which it
refuses to prerender because the value changes between renders.

The cart badge and account menu never had this, because both wrap their session
read in a `'use cache: private'` scope, which is excluded from prerendering by
construction. The wishlist toggle now does the same. The rule, stated once so the
next customer-scoped component gets it right: **a session read belongs inside a
private cache scope, not merely inside a Suspense boundary.**

Notably typecheck, lint, the build, and the whole e2e suite were all green with
this happening on every single product page view — it only ever surfaced as
dev-server log noise.

**4. Failed logins showed no error at all.** next-auth v5 **throws** `AuthError`
on a failed credentials sign-in rather than returning an error shape, so the
action's `if (result.error)` check never ran. Now caught explicitly, with
`NEXT_REDIRECT` and everything else rethrown untouched.

## Still deferred

- **Dynamic customer form fields on registration.** Catalyst builds the form from
  the store's `formFields` configuration, picking up custom fields and per-store
  required flags. This registers the six fields `RegisterCustomerInput` requires
  or commonly uses; everything beyond them is optional at the API. The store's own
  password-complexity and uniqueness rules still apply — BigCommerce validates
  server-side and its wording is surfaced verbatim.
- **Newsletter toggle.** Dropped rather than half-built after reading the schema:
  `NewsletterMutations` offers only `subscribe`/`unsubscribe` by email address,
  not a per-customer preference toggle, while `Customer.isSubscribedToNewsletter`
  is read-only. Wiring the settings checkbox to `subscribe` would let a shopper
  turn it on but never reliably off. Needs a different approach, not more code.
- **reCAPTCHA** on registration and password reset — Phase 7, with the rest of
  the spam-protection work. Until then **both endpoints are unprotected**, and
  registration matters more than the contact form: each submission creates a real
  customer record.
