'use client';

import { useTranslations } from 'next-intl';

import { useActionState } from 'react';


import { removeWishlistItem } from '../_actions/wishlist';

export function RemoveItemButton({
  wishlistId,
  itemId,
  name,
}: {
  wishlistId: number;
  itemId: number;
  name: string;
}) {
  const t = useTranslations();

  const [, formAction, isPending] = useActionState(removeWishlistItem, null);

  return (
    <form action={formAction}>
      <input name="wishlistId" type="hidden" value={wishlistId} />
      <input name="itemId" type="hidden" value={itemId} />
      <button
        aria-label={t('Wishlist.removeItem', { name })}
        className="self-start text-sm text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {t('Cart.remove')}
      </button>
    </form>
  );
}
