import { Suspense } from 'react';

import { getTopLevelCategories, NAV_LIMITS } from '~/data/navigation';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

import { AccountMenu, AccountMenuSkeleton } from './account-menu';
import { CartBadge, CartBadgeSkeleton } from './cart-badge';
import { CategoryNav, CategoryNavSkeleton } from './category-nav';
import { MobileNav } from './mobile-nav';
import { SearchMenu } from './search-menu';
import { StoreLogo } from './store-logo';
import { t } from '~/lib/i18n/messages';

/**
 * Site header.
 *
 * Every region sits behind its own `<Suspense>`, so a slow read in one never
 * blocks the rest of the header from painting. Logo and nav resolve from public
 * cached reads and land in the prerendered shell.
 *
 * The cart badge and account menu are the exceptions, and the reason the
 * boundaries were there from Phase 1: both read a cookie, so both are
 * `'use cache: private'` scopes, excluded from the shell by construction and
 * streamed in behind their skeletons. Neither can hold up the logo or the nav.
 *
 * Those two holes are the *entire* difference between a guest's page and a
 * signed-in shopper's — the rest of the header, and the whole page body, is the
 * same prerendered shell for both.
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
          <SearchMenu />

          <Suspense fallback={<AccountMenuSkeleton />}>
            <AccountMenu />
          </Suspense>

          <Suspense fallback={<CartBadgeSkeleton />}>
            <CartBadge />
          </Suspense>
        </div>
      </div>
    </header>
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
