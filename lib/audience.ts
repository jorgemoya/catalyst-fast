import 'server-only';

import { headers } from 'next/headers';
import { audience } from 'next/root-params';

import { AUDIENCE_HEADER, type Audience } from '~/proxies/audience';

/**
 * Which catalog a request is rendering: the shared one, or a customer-group one.
 *
 * `public` is what guests and every unlisted group see, prerendered and cached
 * for everyone. `restricted` is for groups in `RESTRICTED_CATALOG_GROUPS`, whose
 * catalog visibility differs from guests' — BigCommerce resolves that from the
 * shopper's token, so it cannot come from the shared cache.
 *
 * **Decided in the proxy, not here.** Deciding means reading the session cookie,
 * and reading a cookie anywhere in a page makes that part dynamic *for every
 * visitor*. So the proxy picks the audience and rewrites to
 * `app/[locale]/[audience]/…`, and this reads it back as a **root param** —
 * which is part of the route, legal inside `use cache`, and free for guests.
 *
 * **Changing audience must be a document load.** It is a root param, and the
 * router attempts a soft navigation across one — duplicating the page. Sign-in,
 * registration and sign-out therefore navigate via the browser; see
 * `lib/navigation/document-navigation.ts`. The visible URL does not change with
 * the audience, which is also why the router cache must not survive the move.
 */
export type { Audience } from '~/proxies/audience';

const normalize = (value: string | null | undefined): Audience =>
  value === 'restricted' ? 'restricted' : 'public';

export async function currentAudience(): Promise<Audience> {
  try {
    /*
     * Anything other than `restricted` is `public`, including the empty string
     * the param-independent fallback shell prerenders with — the same trap the
     * locale root param set (see `normalizeLocale`).
     */
    return normalize(await audience());
  } catch {
    /*
     * Server Actions and Route Handlers cannot read root params — Next throws.
     * They reach here through the proxy like any request, so the audience it
     * resolved travels as a header instead. Only this branch touches request
     * state; a page render never gets here.
     */
    return normalize((await headers()).get(AUDIENCE_HEADER));
  }
}
