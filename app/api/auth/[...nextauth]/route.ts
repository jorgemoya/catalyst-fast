import { handlers } from '~/lib/auth';

/**
 * next-auth's own endpoints: CSRF token, session, callback, signout.
 *
 * Under `/api`, which the proxy matcher excludes — so these never pay a
 * `site.route` lookup, and more importantly the proxy can never rewrite them.
 */
export const { GET, POST } = handlers;
