import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getPublicWishlist } from '~/data/public-wishlist';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * A shared wishlist.
 *
 * No authentication: the token *is* the capability, so this is a public,
 * shareable page — and being public is what lets it use the ordinary shared cache
 * rather than a private one.
 *
 * `noindex` all the same. The list belongs to a person who chose to share a link,
 * not to publish a page; a search engine surfacing it would be a privacy
 * surprise, and the URL space is unbounded anyway.
 */

interface Props {
  params: Promise<{ token: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getT();

  const wishlist = await getPublicWishlist((await params).token);

  return {
    title: wishlist?.name || t('Wishlist.title'),
    robots: { index: false, follow: false },
  };
}

export default function PublicWishlistPage({ params }: Props) {
  return (
    <div className="page-container py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <PublicWishlistContent params={params} />
      </Suspense>
    </div>
  );
}

async function PublicWishlistContent({ params }: Props) {
  const t = await getT();

  const wishlist = await getPublicWishlist((await params).token);

  // Also the path a revoked link takes: the owner turned sharing off and
  // BigCommerce stopped returning it.
  if (!wishlist) {
    notFound();
  }

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">{wishlist.name}</h1>

      {wishlist.items.length === 0 ? (
        <p className="mt-6 text-sm text-muted">{t('Wishlist.emptyListTitle')}</p>
      ) : (
        <ul className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4" data-testid="public-wishlist">
          {wishlist.items.map((item) => (
            <li className="flex flex-col gap-2" key={item.id}>
              <Link className="block aspect-square overflow-hidden rounded-(--radius-card) bg-surface" href={item.href}>
                {item.image && (
                  <Image
                    alt={item.image.alt}
                    className="size-full object-cover"
                    height={300}
                    sizes="(min-width: 1024px) 25vw, 50vw"
                    src={item.image.src}
                    width={300}
                  />
                )}
              </Link>
              <Link className="text-sm font-medium hover:underline" href={item.href}>
                {item.name}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
