'use client';

import { useEffect, useState } from 'react';

import { type ServerToast, TOAST_COOKIE_NAME } from '~/domain/toast';
import { cn } from '~/lib/cn';

/**
 * Renders a one-shot server toast and dismisses it.
 *
 * Takes the toast as a prop rather than reading the cookie itself: the cookie is
 * deleted on read, and only the server can do that reliably. The client's job is
 * presentation and the dismiss timer.
 */
export function Toaster({ toast }: { toast: ServerToast | null }) {
  const [visible, setVisible] = useState(Boolean(toast));

  useEffect(() => {
    if (!toast) {
      return;
    }

    /*
     * Clearing happens here because it cannot happen on the server: reading and
     * deleting during render throws `Cookies can only be modified in a Server
     * Action or Route Handler`, and the surrounding Suspense boundary swallowed
     * it — the toast silently never appeared. Expiring it here is what makes the
     * message one-shot; without it the same toast fires on every navigation
     * until `maxAge` runs out.
     */
    document.cookie = `${TOAST_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax`;

    const timer = setTimeout(() => setVisible(false), 5000);

    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast || !visible) {
    return null;
  }

  return (
    <div
      className={cn(
        'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-(--radius-control) border px-4 py-3 text-sm shadow-lg',
        toast.variant === 'error'
          ? 'border-danger bg-background text-danger'
          : 'border-border bg-background text-foreground',
      )}
      // Next's route announcer is also `role="alert"`, so tests need something
      // that identifies this element specifically.
      data-testid="server-toast"
      // `alert` for errors so a screen reader interrupts; `status` otherwise, so
      // a success message is announced without cutting off what is being read.
      role={toast.variant === 'error' ? 'alert' : 'status'}
    >
      {toast.message}
    </div>
  );
}
