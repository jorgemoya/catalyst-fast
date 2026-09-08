import { decodeJwt } from 'jose';
import NextAuth, { type NextAuthConfig } from 'next-auth';
// Imported for its side effect: the `next-auth/jwt` module augmentation in
// `types.d.ts` only applies once the module itself is part of the program.
import 'next-auth/jwt';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

import { clearCartId, getCartId, setCartId } from '~/lib/cart/session';

import { loginWithJwt, loginWithPassword, logoutCustomer } from './mutations';

/**
 * Customer authentication.
 *
 * next-auth 5 with two credential providers, both of which are thin wrappers over
 * a BigCommerce mutation — there is no local user store, and BigCommerce remains
 * the only source of identity.
 *
 * **Why next-auth at all**, given Phase 4 deliberately built guest identity
 * without it: the session carries a `customerAccessToken`, which is a real
 * credential. next-auth's encrypted JWT (JWE) keeps it unreadable in the cookie,
 * and session crypto is the one part of this project genuinely not worth
 * hand-rolling. The guest cart cookie needs none of that — it holds an
 * unguessable id that *is* the capability — which is why the two stayed separate.
 *
 * **The cart id is not on the session.** It stays in `cf.cart` for guests and
 * customers alike. The plan anticipated moving it here; that turned out to be
 * unnecessary and worse. BigCommerce merges the guest cart itself when `login`
 * is given `guestCartEntityId`, so all that is needed is to write the returned id
 * back to the same cookie — leaving `getCartId()` identical for both audiences
 * and one home for the value rather than two that can disagree.
 */

/**
 * Auth is optional infrastructure.
 *
 * Without `AUTH_SECRET` the storefront still runs, guest-first, exactly as it did
 * through Phase 5 — browsing, cart, and checkout are unaffected. Only account
 * features go dark. This is deliberate: a missing secret should not take down a
 * store that never enabled accounts, and `getSession()` returning null is a state
 * every consumer already handles for signed-out visitors.
 */
export const isAuthConfigured = Boolean(process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET);

const cartIdSchema = z
  .string()
  .optional()
  // auth.js stringifies missing credentials, so an absent cart arrives as the
  // literal "undefined" rather than being omitted.
  .transform((value) => (value === 'undefined' || value === '' ? undefined : value));

const PasswordCredentials = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  cartId: cartIdSchema,
});

const JwtCredentials = z.object({
  jwt: z.string().min(1),
  cartId: cartIdSchema,
});

export const config = {
  // Left undefined on purpose: next-auth then performs its own CSRF checks on
  // sign-in and sign-out. Setting it to `true` disables that.
  skipCSRFCheck: undefined,
  /*
   * Whether to build callback URLs from the request's `Host` header.
   *
   * Left as an explicit opt-in rather than defaulted on: a spoofed Host would let
   * an attacker point the sign-in flow at their own domain. next-auth auto-trusts
   * on Vercel, so this only matters when self-hosting — where it is **required**,
   * and its absence surfaces as an opaque `UntrustedHost` on every auth request
   * rather than at startup.
   */
  trustHost: process.env.AUTH_TRUST_HOST === 'true' ? true : undefined,
  session: { strategy: 'jwt' },
  pages: { signIn: '/login', signOut: '/logout' },
  providers: [
    Credentials({
      id: 'password',
      credentials: { email: {}, password: {}, cartId: {} },
      async authorize(credentials) {
        const parsed = PasswordCredentials.safeParse(credentials);

        if (!parsed.success) {
          return null;
        }

        const { email, password, cartId } = parsed.data;

        // A failed login must return null rather than throw: next-auth turns a
        // throw into a redirect with an opaque error, and the login form needs to
        // say "those credentials are wrong" in place.
        try {
          return await loginWithPassword(email, password, cartId);
        } catch {
          return null;
        }
      },
    }),

    /**
     * Customer Login API JWT — SSO from an external identity provider, and B2B
     * agent impersonation. The channel and impersonator come from the token's own
     * claims, so a caller cannot assert them separately.
     */
    Credentials({
      id: 'jwt',
      credentials: { jwt: {}, cartId: {} },
      async authorize(credentials) {
        const parsed = JwtCredentials.safeParse(credentials);

        if (!parsed.success) {
          return null;
        }

        const { jwt, cartId } = parsed.data;

        try {
          const claims = decodeJwt(jwt);

          return await loginWithJwt(jwt, cartId, claims.impersonator_id?.toString() ?? null);
        } catch {
          return null;
        }
      },
    }),
  ],
  callbacks: {
    async signIn({ user }) {
      // BigCommerce has already merged the guest cart into the customer's; all
      // that remains is to point the cookie at whatever it handed back.
      if (user?.mergedCartId) {
        await setCartId(user.mergedCartId);
      }

      return true;
    },
    /*
     * `user` is **only present on the initial sign-in**. next-auth runs this
     * callback on every subsequent session read too, with `user` undefined — so
     * the optional chaining is load-bearing, not defensive style.
     *
     * next-auth's own types declare `user: User` as non-optional, which is wrong
     * at runtime. Trusting them threw `TypeError: Cannot read properties of
     * undefined (reading 'customerAccessToken')` inside the callback, which
     * next-auth swallows into a generic `JWTSessionError` — so the visible
     * symptom was a login that silently bounced back to `/login` with no error,
     * rather than anything pointing at this line.
     */
    jwt({ token, user }) {
      if (user?.customerAccessToken) {
        token.customerId = user.customerId;
        token.customerGroupId = user.customerGroupId;
        token.customerAccessToken = user.customerAccessToken;
        token.firstName = user.firstName;
        token.lastName = user.lastName;
        token.impersonatorId = user.impersonatorId ?? null;
      }

      return token;
    },
    /*
     * Same runtime-vs-types trap as `jwt` above, one level along: next-auth
     * declares `token: JWT` non-optional, but passes it as undefined whenever the
     * session cookie fails to decode — a cookie encrypted with a previous
     * `AUTH_SECRET`, or one predating a change to the token's shape.
     *
     * That makes a stale cookie in a *developer's own browser* throw on every
     * session read, while a fresh incognito window works perfectly. The symptom
     * is "login is broken for me but the tests pass", which points nowhere near
     * this line. Guarding here degrades a bad cookie to "signed out", which is
     * both correct and self-healing.
     */
    session({ session, token }) {
      if (token?.customerAccessToken) {
        session.user.customerId = token.customerId ?? 0;
        session.user.customerGroupId = token.customerGroupId ?? 0;
        session.user.customerAccessToken = token.customerAccessToken;
        session.user.firstName = token.firstName ?? '';
        session.user.lastName = token.lastName ?? '';
        session.user.impersonatorId = token.impersonatorId ?? null;
      }

      return session;
    },
  },
  events: {
    /**
     * Sign-out has to end the session at BigCommerce too, not just drop our
     * cookie — otherwise the access token stays valid until it expires.
     *
     * The cart handling is the subtle part: with persistent cart disabled,
     * BigCommerce hands the cart back as an anonymous one, and pointing the cookie
     * at it is what stops signing out from silently emptying a shopper's basket.
     */
    async signOut(message) {
      const token = 'token' in message ? message.token : null;

      if (!token?.customerAccessToken) {
        return;
      }

      const cartId = await getCartId();

      try {
        const unassignedCartId = await logoutCustomer(token.customerAccessToken, cartId);

        if (unassignedCartId) {
          await setCartId(unassignedCartId);
        } else {
          // BigCommerce kept the cart with the customer, so this browser has no
          // cart any more. Leaving a stale id would show a phantom badge count.
          await clearCartId();
        }
      } catch (error) {
        // Never block sign-out on BigCommerce being unreachable — the local
        // session is already gone and the shopper must not be stuck signed in.
        console.error('[auth] logout', error);
      }
    },
  },
} satisfies NextAuthConfig;

export const { handlers, signIn, signOut, auth } = NextAuth(config);
