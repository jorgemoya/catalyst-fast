import { Suspense } from 'react';

import { getTopLevelCategories, NAV_LIMITS } from '~/data/navigation';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

import { CategoryNav, CategoryNavSkeleton } from './category-nav';
import { MobileNav } from './mobile-nav';
import { StoreLogo } from './store-logo';
import { t } from '~/lib/i18n/messages';

/**
 * Site header.
 *
 * Every region sits behind its own `<Suspense>`, so a slow read in one never
 * blocks the rest of the header from painting. Today all of them resolve from
 * cached reads and land in the prerendered shell; the boundaries are here because
 * Phase 4 drops a genuinely dynamic cart badge into `Actions` and Phase 6 adds
 * account state, and neither should be able to hold up the logo or nav.
 *
 * Cart and account are static placeholders for now — a guest sees exactly this,
 * and the count/name stream in once those phases land.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-sm">
      <div className="page-container flex h-16 items-center gap-4">
        <Suspense fallback={<Skeleton className="h-8 w-32" />}>
          <MobileNavContents />
        </Suspense>

        <Suspense fallback={<Skeleton className="h-8 w-32" />}>
          <StoreLogo className="shrink-0" />
        </Suspense>

        <nav aria-label={t('Header.mainNav')} className="flex-1">
          <Suspense fallback={<CategoryNavSkeleton />}>
            <CategoryNav />
          </Suspense>
        </nav>

        <div className="flex shrink-0 items-center gap-1">
          <IconLink href="/search" label={t('Header.search')}>
            <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
              <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
              <path d="m20 20-3.5-3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            </svg>
          </IconLink>

          <IconLink href="/login" label={t('Header.account')}>
            <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
              <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
              <path d="M4 20c0-3.3 3.6-6 8-6s8 2.7 8 6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
            </svg>
          </IconLink>

          {/* Phase 4 replaces this with <CartBadge/> in its own Suspense boundary. */}
          <IconLink href="/cart" label={t('Header.cart')}>
            <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
              <path
                d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.55L20.5 8H6"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
              />
              <circle cx="10" cy="20" r="1.5" fill="currentColor" />
              <circle cx="17" cy="20" r="1.5" fill="currentColor" />
            </svg>
          </IconLink>
        </div>
      </div>
    </header>
  );
}

function IconLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      aria-label={label}
      className="inline-flex size-9 items-center justify-center rounded-(--radius-control) hover:bg-accent"
      href={href}
    >
      {children}
    </Link>
  );
}

/**
 * Server-rendered links handed to the mobile drawer as children, so the drawer
 * island itself stays data-free.
 *
 * Top-level only, and capped. This markup ships on **every page**, so anything
 * rendered here is multiplied across the whole site: the previous version mapped
 * every category *and* its children, which on a 1000-category store would have
 * added hundreds of KB to every response. Subcategories are one tap away on the
 * category page itself, which is where they belong.
 */
async function MobileNavContents() {
  const categories = await getTopLevelCategories();
  const visible = categories.slice(0, NAV_LIMITS.mobile);

  return (
    <MobileNav>
      <ul className="flex flex-col gap-1">
        {visible.map((category) => (
          <li key={category.id}>
            <Link className="block py-2 text-sm font-medium" href={category.href}>
              {category.label}
            </Link>
          </li>
        ))}

        {categories.length > visible.length && (
          <li className="mt-2 border-t border-border pt-2">
            <Link className="block py-2 text-sm font-medium text-primary" href="/shop-all/">
              {t('Common.allCategories')}
            </Link>
          </li>
        )}
      </ul>
    </MobileNav>
  );
}
