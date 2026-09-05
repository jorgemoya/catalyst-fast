'use client';

import { Dialog } from '@base-ui/react/dialog';
import type { ReactNode } from 'react';

/**
 * Mobile drawer. A separate island from `NavMenu` on purpose — desktop visitors
 * never need this code, and mobile visitors never need the mega-menu positioner.
 * Splitting them is only possible because neither takes data as props.
 */
export function MobileNav({ children }: { children: ReactNode }) {
  return (
    <Dialog.Root>
      <Dialog.Trigger
        aria-label="Open menu"
        className="inline-flex size-9 items-center justify-center rounded-(--radius-control) hover:bg-accent lg:hidden"
      >
        <svg aria-hidden="true" fill="none" height="20" viewBox="0 0 24 24" width="20">
          <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-(--duration-fast) data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="fixed inset-y-0 start-0 z-50 flex w-80 max-w-[85vw] flex-col overflow-y-auto bg-background p-6 transition-transform duration-(--duration-slow) ease-(--ease-out-quart) data-ending-style:-translate-x-full data-starting-style:-translate-x-full">
          <div className="mb-6 flex items-center justify-between">
            <Dialog.Title className="text-sm font-semibold">Menu</Dialog.Title>
            <Dialog.Close
              aria-label="Close menu"
              className="inline-flex size-8 items-center justify-center rounded-(--radius-control) hover:bg-accent"
            >
              <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
                <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              </svg>
            </Dialog.Close>
          </div>

          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
