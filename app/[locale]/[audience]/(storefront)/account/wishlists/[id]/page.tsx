import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { getWishlist } from '~/data/customer/wishlist';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';

import { RemoveItemButton } from '../_components/remove-item';

/** Translated, so it must be generated per request rather than at import. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return {
  title: t('Wishlist.title'),
  robots: { index: false, follow: false },
  };
}

interface Props {
  params: Promise<{ id: string }>;
}

export default async function WishlistDetailPage({ params }: Props) {
  const t = await getT();

  const wishlist = await getWishlist(Number((await params).id));

  if (!wishlist) {
    notFound();
  }

  return (
    <section>
      <Link className="text-sm text-muted underline underline-offset-4" href="/account/wishlists">
        {t('Wishlist.back')}
      </Link>

      <h2 className="mt-4 text-lg font-semibold">{wishlist.name}</h2>

      {wishlist.isPublic && (
        <p className="mt-2 text-sm text-muted">
          {t('Wishlist.shareLink')}{' '}
          <code className="rounded bg-accent px-1">/wishlist/{wishlist.token}</code>
        </p>
      )}

      {wishlist.items.length === 0 ? (
        <div className="mt-6 rounded-(--radius-card) border border-border py-16 text-center">
          <h3 className="font-semibold">{t('Wishlist.emptyListTitle')}</h3>
          <p className="mt-2 text-sm text-muted">{t('Wishlist.emptyListSubtitle')}</p>
        </div>
      ) : (
        <ul className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3" data-testid="wishlist-items">
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
              <RemoveItemButton itemId={item.id} name={item.name} wishlistId={wishlist.id} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
