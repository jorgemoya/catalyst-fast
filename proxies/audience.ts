import { getToken } from 'next-auth/jwt';
import type { NextRequest } from 'next/server';

import { env } from '~/lib/env';

/**
 * Picks the catalog audience for a request — `public` or `restricted`.
 *
 * Runs in the proxy because deciding means reading the session, and reading a
 * cookie inside a page makes that part of the page dynamic for **every**
 * visitor. Here it costs nothing on a page, and the answer travels as the
 * `[audience]` root param (see `lib/audience.ts`).
 *
 * The guest path stays as cheap as before: with no groups configured, or no
 * session cookie, this returns without touching the JWT. Only a signed-in
 * shopper on a store that restricts its catalog pays for a decode.
 *
 * Kept free of `next/root-params` and `server-only`; the proxy imports it.
 */

export type Audience = 'public' | 'restricted';

export const AUDIENCE_HEADER = 'x-cf-audience';

const SESSION_COOKIE_RE = /^(__Secure-)?authjs\.session-token(\.\d+)?$/u;

export interface ResolvedAudience {
  audience: Audience;
  /** Present only for `restricted` — used to resolve the route as the shopper. */
  customerAccessToken?: string;
}

const PUBLIC: ResolvedAudience = { audience: 'public' };

export async function resolveAudience(request: NextRequest): Promise<ResolvedAudience> {
  const groups = env.RESTRICTED_CATALOG_GROUPS;
  const secret = process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET;

  if (groups.length === 0 || !secret) {
    return PUBLIC;
  }

  const sessionCookie = request.cookies.getAll().find((cookie) => SESSION_COOKIE_RE.test(cookie.name));

  if (!sessionCookie) {
    return PUBLIC;
  }

  // Chunked tokens are `name.0`, `name.1`; getToken reassembles from the base.
  const cookieName = sessionCookie.name.replace(/\.\d+$/u, '');

  try {
    const token = await getToken({ req: request, secret, salt: cookieName, cookieName });
    const groupId = typeof token?.customerGroupId === 'number' ? token.customerGroupId : null;
    const customerAccessToken =
      typeof token?.customerAccessToken === 'string' ? token.customerAccessToken : undefined;

    if (groupId !== null && customerAccessToken && groups.includes(groupId)) {
      return { audience: 'restricted', customerAccessToken };
    }
  } catch {
    // An undecodable cookie — rotated secret, stale shape — is a guest.
  }

  return PUBLIC;
}
