import type { Metadata } from 'next';

import { getWishlists } from '~/data/customer/wishlist';
import { t } from '~/lib/i18n/messages';

import { WishlistManager } from './_components/wishlist-manager';

export const metadata: Metadata = {
  title: t('Wishlist.title'),
  robots: { index: false, follow: false },
};

export default async function WishlistsPage() {
  const wishlists = await getWishlists();

  return <WishlistManager wishlists={wishlists} />;
}
