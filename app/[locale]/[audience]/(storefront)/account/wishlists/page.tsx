import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';

import { getWishlists } from '~/data/customer/wishlist';

import { WishlistManager } from './_components/wishlist-manager';

/** Translated, so it must be generated per request rather than at import. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return {
  title: t('Wishlist.title'),
  robots: { index: false, follow: false },
  };
}

export default async function WishlistsPage() {
  const wishlists = await getWishlists();

  return <WishlistManager wishlists={wishlists} />;
}
