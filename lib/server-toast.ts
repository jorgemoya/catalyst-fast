import 'server-only';

import { cookies } from 'next/headers';

import { type ServerToast, TOAST_COOKIE_NAME, parseToast } from '~/domain/toast';

/**
 * One-shot notifications that survive a redirect.
 *
 * A Server Action or Route Handler that ends in a redirect loses its return
 * value — the render that would have shown a message never happens. So the
 * message travels in a short-lived cookie and is shown on the *next* page.
 *
 * **The clearing happens on the client, and that is not a shortcut.** The
 * obvious design is read-and-delete on the server, and this module used to do
 * exactly that. It does not work: `getServerToast` runs during *render*, and
 * Next refuses cookie mutation there —
 *
 *   ⨯ Cookies can only be modified in a Server Action or Route Handler.
 *
 * The throw was swallowed by the `<Suspense fallback={null}>` around
 * `ToasterGate`, so the mechanism failed completely and silently: no toast ever
 * appeared, and nothing in the build, the tests, or the console said so. The
 * cookie is deliberately not `httpOnly`, which is what lets `Toaster` clear it
 * after showing it.
 *
 * `maxAge` is the backstop for a shopper with JavaScript off: the toast simply
 * expires rather than repeating indefinitely.
 */

export type { ServerToast, ToastVariant } from '~/domain/toast';

/**
 * Queues a toast for the next request.
 *
 * **Legal only in a Server Action or Route Handler** — the same constraint that
 * broke the read path. Calling it during render throws.
 *
 * `maxAge` is deliberately tiny. A toast is about what just happened; one that
 * survives minutes would fire on an unrelated page after a shopper wandered off
 * and came back, which reads as a bug.
 */
export async function setServerToast(toast: ServerToast): Promise<void> {
  const store = await cookies();

  store.set(TOAST_COOKIE_NAME, JSON.stringify(toast), {
    // Not httpOnly: nothing sensitive, and the client must be able to clear it.
    path: '/',
    maxAge: 30,
    sameSite: 'lax',
  });
}

/**
 * Reads the pending toast. **Does not clear it** — see the note above.
 *
 * Safe during render because it only reads. Still dynamic, so its caller belongs
 * in its own `<Suspense>` boundary.
 */
export async function getServerToast(): Promise<ServerToast | null> {
  const store = await cookies();

  return parseToast(store.get(TOAST_COOKIE_NAME)?.value);
}
