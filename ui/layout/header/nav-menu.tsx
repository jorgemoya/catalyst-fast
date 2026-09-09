'use client';

import { useTranslations } from 'next-intl';

import { NavigationMenu } from '@base-ui/react/navigation-menu';

import { Link } from '~/ui/primitives/link';
import type { ReactNode } from 'react';

/**
 * The interactive shell of the mega-menu — and nothing else.
 *
 * This is the point of the header rewrite. Catalyst's `navigation` primitive was
 * 1056 lines of `'use client'` with 35 props, bundling the mega-menu, search,
 * locale switcher, currency switcher, and mobile drawer into one module, so every
 * visitor downloaded all five features whether or not they touched any.
 *
 * Here the client boundary owns only open/close behavior and keyboard handling.
 * Panel contents arrive as `children` — server-rendered markup — so no category
 * data crosses the RSC boundary as serialized props, and adding a category costs
 * zero client bytes. Search and the mobile drawer are separate islands.
 */

export function NavMenu({ children }: { children: ReactNode }) {
  return (
    <NavigationMenu.Root className="max-lg:hidden">
      <NavigationMenu.List className="flex items-center gap-1">{children}</NavigationMenu.List>

      <NavigationMenu.Portal>
        <NavigationMenu.Positioner
          className="z-50 outline-none"
          collisionPadding={16}
          sideOffset={10}
        >
          <NavigationMenu.Popup className="w-(--positioner-width) origin-(--transform-origin) rounded-(--radius-card) border border-border bg-surface-raised shadow-lg transition-[opacity,transform] duration-(--duration-fast) ease-(--ease-out-quart) data-ending-style:opacity-0 data-starting-style:opacity-0">
            <NavigationMenu.Viewport className="relative h-(--popup-height) w-full overflow-hidden transition-[height] duration-(--duration-fast) ease-(--ease-out-quart)" />
          </NavigationMenu.Popup>
        </NavigationMenu.Positioner>
      </NavigationMenu.Portal>
    </NavigationMenu.Root>
  );
}

const itemClasses =
  'inline-flex items-center gap-1 rounded-(--radius-control) px-3 py-2 text-sm font-medium hover:bg-accent data-popup-open:bg-accent';

/**
 * A top-level category.
 *
 * Both variants must be navigable — a shopper clicking "Plants" expects the
 * Plants listing, not just a menu. So:
 *
 *   - No children  → a plain link.
 *   - Has children → a disclosure button that opens the panel, and the panel's
 *     first entry is a "Shop all X" link to the category itself.
 *
 * The trigger stays a `<button>` rather than becoming a link, because it toggles
 * a popup: that is what the element does, and announcing it as a link while it
 * opens a menu would be wrong for assistive tech. The category remains reachable
 * from inside the panel.
 */
export function NavMenuItem({
  label,
  href,
  children,
}: {
  label: string;
  href: string;
  children?: ReactNode;
}) {
  const t = useTranslations();

  if (!children) {
    return (
      <NavigationMenu.Item>
        <NavigationMenu.Link className={itemClasses} render={<Link href={href} />}>
          {label}
        </NavigationMenu.Link>
      </NavigationMenu.Item>
    );
  }

  return (
    <NavigationMenu.Item>
      <NavigationMenu.Trigger className={itemClasses}>
        {label}
        <svg
          aria-hidden="true"
          className="transition-transform duration-(--duration-fast) data-popup-open:rotate-180"
          fill="none"
          height="14"
          viewBox="0 0 24 24"
          width="14"
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      </NavigationMenu.Trigger>

      <NavigationMenu.Content className="w-full p-6 transition-[opacity,transform] duration-(--duration-fast) ease-(--ease-out-quart) data-ending-style:opacity-0 data-starting-style:opacity-0">
        <NavigationMenu.Link
          className="mb-4 inline-block text-sm font-semibold text-primary underline-offset-4 hover:underline"
          render={<Link href={href} />}
        >
          {t('Header.shopAllCategory', { category: label })}
        </NavigationMenu.Link>
        {children}
      </NavigationMenu.Content>
    </NavigationMenu.Item>
  );
}

/**
 * Links inside a panel. Wrapping them in `NavigationMenu.Link` is what closes the
 * menu on navigation — a plain `<a>` would leave the panel open over the new page.
 */
export function NavPanelLink({
  href,
  className,
  children,
}: {
  href: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <NavigationMenu.Link className={className} render={<Link href={href} />}>
      {children}
    </NavigationMenu.Link>
  );
}
