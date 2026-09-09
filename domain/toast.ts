/**
 * One-shot notification that survives a redirect.
 *
 * Shared between the server (which writes it) and the client (which clears it),
 * so it lives here rather than in `lib/server-toast.ts` — that module is
 * `server-only` and a Client Component cannot import from it. Same split as
 * `domain/consent.ts`.
 */

export const TOAST_COOKIE_NAME = 'cf.toast';

export type ToastVariant = 'success' | 'error' | 'info';

export interface ServerToast {
  variant: ToastVariant;
  message: string;
}

const VARIANTS: string[] = ['success', 'error', 'info'];

/**
 * Parses a toast cookie, tolerating anything.
 *
 * A malformed value is not worth an error page: the cookie is short-lived and
 * shopper-visible, so garbage in it should mean "no toast", never a crash.
 */
export function parseToast(raw: string | undefined | null): ServerToast | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('message' in parsed) ||
      typeof parsed.message !== 'string'
    ) {
      return null;
    }

    const variant =
      'variant' in parsed && typeof parsed.variant === 'string' ? parsed.variant : 'info';

    return {
      message: parsed.message,
      variant: VARIANTS.includes(variant) ? (variant as ToastVariant) : 'info',
    };
  } catch {
    return null;
  }
}
