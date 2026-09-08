'use client';

import { useActionState, useState } from 'react';

import type { Wishlist } from '~/data/customer/wishlist';
import { t } from '~/lib/i18n/messages';
import { inputClass } from '~/ui/patterns/form-field';
import { Link } from '~/ui/primitives/link';

import {
  createWishlist,
  deleteWishlist,
  renameWishlist,
  setWishlistVisibility,
} from '../_actions/wishlist';

export function WishlistManager({ wishlists }: { wishlists: Wishlist[] }) {
  const [renaming, setRenaming] = useState<number | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <CreateForm />

      {wishlists.length === 0 ? (
        <div className="rounded-(--radius-card) border border-border py-16 text-center">
          <h2 className="text-lg font-semibold">{t('Wishlist.emptyTitle')}</h2>
          <p className="mt-2 text-sm text-muted">{t('Wishlist.emptySubtitle')}</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border border-y border-border" data-testid="wishlists">
          {wishlists.map((wishlist) => (
            <li className="flex flex-wrap items-center justify-between gap-4 py-4" key={wishlist.id}>
              <div className="min-w-0">
                {renaming === wishlist.id ? (
                  <RenameForm
                    id={wishlist.id}
                    name={wishlist.name}
                    onDone={() => setRenaming(null)}
                  />
                ) : (
                  <>
                    <Link className="font-medium hover:underline" href={`/account/wishlists/${wishlist.id}`}>
                      {wishlist.name}
                    </Link>
                    <p className="text-sm text-muted">
                      {t('Wishlist.itemCount', { count: wishlist.items.length })}
                      {wishlist.isPublic && ` · ${t('Wishlist.public')}`}
                    </p>
                  </>
                )}
              </div>

              {renaming !== wishlist.id && (
                <div className="flex items-center gap-3 text-sm">
                  <button
                    className="text-primary underline underline-offset-4"
                    onClick={() => setRenaming(wishlist.id)}
                    type="button"
                  >
                    {t('Wishlist.rename')}
                  </button>
                  <VisibilityForm id={wishlist.id} isPublic={wishlist.isPublic} />
                  <DeleteForm id={wishlist.id} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateForm() {
  const [result, formAction, isPending] = useActionState(createWishlist, null);
  const nameErrors = result?.error?.name ?? [];

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div>
        <label className="mb-2 block text-sm font-medium" htmlFor="new-wishlist">
          {t('Wishlist.nameLabel')}
        </label>
        <input className={inputClass} id="new-wishlist" name="name" required />
        {nameErrors.length > 0 && (
          <p className="mt-1 text-sm text-error" role="alert">
            {nameErrors.join(' ')}
          </p>
        )}
      </div>
      <button
        className="h-10 rounded-(--radius-control) bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {isPending ? t('Wishlist.creating') : t('Wishlist.create')}
      </button>
    </form>
  );
}

function RenameForm({ id, name, onDone }: { id: number; name: string; onDone: () => void }) {
  const [, formAction, isPending] = useActionState(renameWishlist, null);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input name="wishlistId" type="hidden" value={id} />
      <input className={inputClass} defaultValue={name} name="name" required />
      <button className="text-sm text-primary underline" disabled={isPending} type="submit">
        {t('Account.save')}
      </button>
      <button className="text-sm text-muted underline" onClick={onDone} type="button">
        {t('Account.cancel')}
      </button>
    </form>
  );
}

/**
 * Sharing toggles `isPublic`, which is what makes the `token` link resolve at
 * `/wishlist/[token]`. Turning it off does not change the token — it just stops
 * BigCommerce serving it, so a previously shared link goes dead rather than
 * leaking.
 */
function VisibilityForm({ id, isPublic }: { id: number; isPublic: boolean }) {
  const [, formAction, isPending] = useActionState(setWishlistVisibility, null);

  return (
    <form action={formAction} className="inline">
      <input name="wishlistId" type="hidden" value={id} />
      <input name="isPublic" type="hidden" value={String(!isPublic)} />
      <button className="text-primary underline underline-offset-4 disabled:opacity-50" disabled={isPending} type="submit">
        {isPublic ? t('Wishlist.makePrivate') : t('Wishlist.makePublic')}
      </button>
    </form>
  );
}

function DeleteForm({ id }: { id: number }) {
  const [, formAction, isPending] = useActionState(deleteWishlist, null);

  return (
    <form action={formAction} className="inline">
      <input name="wishlistId" type="hidden" value={id} />
      <button className="text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50" disabled={isPending} type="submit">
        {t('Wishlist.delete')}
      </button>
    </form>
  );
}
