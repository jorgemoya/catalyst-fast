import 'server-only';

import { cookies } from 'next/headers';

/**
 * One-shot notifications that survive a redirect.
 *
 * A Server Action that ends in `redirect()` loses its return value — the render
 * that would have shown a message never happens. The cart's "added to your cart"
 * and the checkout handoff's error both need to say something on the *next*
 * page, so the message travels in a short-lived cookie and is consumed on read.
 *
 * **Never call `getServerToast` from a cached scope.** It reads and writes
 * cookies, which is illegal inside `use cache` and would throw at build time.
 * It belongs in a dynamic hole — see `ui/patterns/toaster.tsx`.
 */

const TOAST_COOKIE = 'cf.toast';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ServerToast {
  variant: ToastVariant;
  message: string;
}

/**
 * Queues a toast for the next request.
 *
 * `maxAge` is deliberately tiny. A toast is about what just happened; one that
 * survives minutes would fire on an unrelated page after a shopper wandered off
 * and came back, which reads as a bug.
 */
export async function setServerToast(toast: ServerToast): Promise<void> {
  const store = await cookies();

  store.set(TOAST_COOKIE, JSON.stringify(toast), {
    // Not httpOnly: nothing sensitive, and it stays readable for debugging.
    path: '/',
    maxAge: 30,
    sameSite: 'lax',
  });
}

/**
 * Reads and clears the pending toast.
 *
 * Deleting on read is what makes it one-shot. Without that, the message would
 * re-appear on every navigation until the cookie expired.
 */
export async function getServerToast(): Promise<ServerToast | null> {
  const store = await cookies();
  const raw = store.get(TOAST_COOKIE)?.value;

  if (!raw) {
    return null;
  }

  store.delete(TOAST_COOKIE);

  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'message' in parsed &&
      typeof parsed.message === 'string'
    ) {
      const variant =
        'variant' in parsed && typeof parsed.variant === 'string' ? parsed.variant : 'info';

      return {
        message: parsed.message,
        variant: (['success', 'error', 'info'] as string[]).includes(variant)
          ? (variant as ToastVariant)
          : 'info',
      };
    }
  } catch {
    // A malformed cookie is not worth an error page; it has been cleared above.
  }

  return null;
}
