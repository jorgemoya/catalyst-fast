'use client';

import { Popover } from '@base-ui/react/popover';
import { useActionState } from 'react';

import {
  addToWishlist,
  removeWishlistItem,
} from '~/app/(storefront)/account/wishlists/_actions/wishlist';
import { t } from '~/lib/i18n/messages';
import { HeartIcon } from '~/ui/primitives/heart-icon';

/**
 * The signed-in heart: a popover listing the shopper's wishlists, each row
 * toggling this product in or out of that list.
 *
 * A popover rather than a single toggle because a shopper can have several lists
 * and "saved" is ambiguous across them — Catalyst makes the same call. The
 * checkmark comes from `itemId` being non-null, which is also exactly what the
 * remove mutation needs, so no second lookup is required to un-save.
 */
interface WishlistRow {
  id: number;
  name: string;
  /** Non-null when this product is already in that list. */
  itemId: number | null;
}

export function WishlistButton({
  productId,
  wishlists,
  containing,
}: {
  productId: number;
  wishlists: WishlistRow[];
  containing: number[];
}) {
  const saved = containing.length > 0;

  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={saved ? t('Wishlist.saved') : t('Wishlist.save')}
        aria-pressed={saved}
        className="inline-flex size-10 items-center justify-center rounded-(--radius-control) border border-border hover:bg-accent"
        data-testid="wishlist-toggle"
      >
        <HeartIcon filled={saved} />
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner sideOffset={8}>
          <Popover.Popup className="w-64 rounded-(--radius-card) border border-border bg-background p-2 shadow-lg">
            {wishlists.length === 0 ? (
              <p className="p-2 text-sm text-muted">{t('Wishlist.emptyTitle')}</p>
            ) : (
              <ul className="flex flex-col">
                {wishlists.map((wishlist) => (
                  <li key={wishlist.id}>
                    <ToggleRow productId={productId} wishlist={wishlist} />
                  </li>
                ))}
              </ul>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ToggleRow({ productId, wishlist }: { productId: number; wishlist: WishlistRow }) {
  const inList = wishlist.itemId !== null;
  const [, formAction, isPending] = useActionState(
    inList ? removeWishlistItem : addToWishlist,
    null,
  );

  return (
    <form action={formAction}>
      <input name="wishlistId" type="hidden" value={wishlist.id} />
      {inList ? (
        <input name="itemId" type="hidden" value={wishlist.itemId ?? ''} />
      ) : (
        <input name="productId" type="hidden" value={productId} />
      )}
      <button
        className="flex w-full items-center gap-2 rounded-(--radius-control) p-2 text-start text-sm hover:bg-accent disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        <span aria-hidden="true" className="w-4">
          {inList ? '✓' : ''}
        </span>
        {wishlist.name}
      </button>
    </form>
  );
}
