import { cacheLife } from 'next/cache';
import { Suspense } from 'react';

import { getSiteLinks, getTopLevelCategories, NAV_LIMITS } from '~/data/navigation';
import { getStoreSettings } from '~/data/settings';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

import { SocialLinks } from './social-links';

/**
 * Site footer. Entirely server-rendered from two cached reads, both of which are
 * already in memory by the time this renders (the header uses the same entries),
 * so the footer costs zero additional BigCommerce requests.
 */
export function Footer() {
  return (
    <footer className="mt-24 border-t border-border bg-surface">
      <div className="page-container py-12">
        <Suspense fallback={<FooterSkeleton />}>
          <FooterContents />
        </Suspense>
      </div>
    </footer>
  );
}

/**
 * The copyright year is an unstable value: `new Date()` can differ between
 * renders, so calling it directly makes the whole footer unprerenderable and
 * takes the storefront layout out of the static shell with it.
 *
 * Caching it is the right fix rather than a trick — the year is a slow-moving
 * derived value, and `days` (revalidate 86400) means the footer self-corrects
 * within a day of January 1st. The alternative, rendering it client-side, would
 * ship JS for a four-character string.
 */
async function getCopyrightYear(): Promise<number> {
  'use cache';
  cacheLife('days');

  return new Date().getFullYear();
}

async function FooterContents() {
  const [categories, { brands, pages }, settings, year] = await Promise.all([
    getTopLevelCategories(),
    getSiteLinks(),
    getStoreSettings(),
    getCopyrightYear(),
  ]);

  // Capped because the footer renders on every page — an uncapped list makes
  // catalog size a per-page HTML cost across the entire site.
  const shopLinks = categories
    .slice(0, NAV_LIMITS.footer)
    .map(({ label, href }) => ({ label, href }));

  if (categories.length > shopLinks.length) {
    shopLinks.push({ label: 'All categories', href: '/shop-all/' });
  }

  return (
    <>
      <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
        <FooterColumn heading="Shop" links={shopLinks} />
        <FooterColumn heading="Brands" links={brands} />
        <FooterColumn heading="About" links={pages} />

        <div className="flex flex-col gap-3">
          <h2 className="text-2xs font-semibold tracking-wide uppercase">Contact</h2>

          {settings.contact && (
            <address className="flex flex-col gap-1 text-sm text-muted not-italic">
              {settings.contact.address && (
                // BigCommerce stores the address as a single field with embedded
                // newlines; preserve them rather than collapsing to one line.
                <span className="whitespace-pre-line">{settings.contact.address}</span>
              )}
              {settings.contact.phone && (
                <a className="hover:text-foreground" href={`tel:${settings.contact.phone}`}>
                  {settings.contact.phone}
                </a>
              )}
              {settings.contact.email && (
                <a className="hover:text-foreground" href={`mailto:${settings.contact.email}`}>
                  {settings.contact.email}
                </a>
              )}
            </address>
          )}

          <SocialLinks links={settings.socialMediaLinks} />
        </div>
      </div>

      <div className="mt-12 border-t border-border pt-6 text-xs text-muted">
        © {year} {settings.storeName}. All rights reserved.
      </div>
    </>
  );
}

function FooterColumn({
  heading,
  links,
}: {
  heading: string;
  links: Array<{ label: string; href: string }>;
}) {
  if (links.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-2xs font-semibold tracking-wide uppercase">{heading}</h2>
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <li key={`${link.href}-${link.label}`}>
            <Link className="text-sm text-muted hover:text-foreground" href={link.href}>
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FooterSkeleton() {
  return (
    <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, column) => (
        <div className="flex flex-col gap-3" key={column}>
          <Skeleton className="h-3 w-20" />
          {Array.from({ length: 4 }, (_, row) => (
            <Skeleton className="h-4 w-28" key={row} />
          ))}
        </div>
      ))}
    </div>
  );
}
