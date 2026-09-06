'use client';

import { useActionState } from 'react';

import { cn } from '~/lib/cn';
import { t } from '~/lib/i18n/messages';

import { updateLineItem } from '../_actions/line-items';

/**
 * Quantity and removal for one cart line.
 *
 * A single `<form>` with three ways to submit, so the whole thing works with
 * JavaScript disabled: `−`/`+` send a relative `delta`, the number input sends an
 * absolute `quantity` on Enter or via Update, and Remove sends `remove`. The
 * server resolves all three to a target quantity.
 *
 * The form carries only the line id. Everything else the update needs — product,
 * variant, selected options — is re-read server-side from the cached cart, so a
 * rewritten hidden input can't turn one line into a different product.
 *
 * `useActionState` is here for the error and pending states, not for the
 * submission itself; without it a failed update would be silent.
 */

interface Props {
  lineItemId: string;
  quantity: number;
  name: string;
  /** Gift certificates have no quantity — removal only. */
  removeOnly?: boolean;
}

export function LineItemControls({ lineItemId, quantity, name, removeOnly = false }: Props) {
  const [result, formAction, isPending] = useActionState(updateLineItem, null);
  const errors = result?.error?.[''] ?? [];

  return (
    <form action={formAction} className="flex flex-col items-start gap-2">
      <input name="lineItemId" type="hidden" value={lineItemId} />

      {/*
        First submit button in the DOM, and deliberately so: pressing Enter in the
        quantity input triggers a form's *first* submit button, which would
        otherwise be `−` and would decrement instead of applying what was typed.
        Visually hidden but keyboard-reachable, so it also gives assistive-tech
        users an explicit way to commit the value.
      */}
      {!removeOnly && (
        <button className="sr-only" name="update" type="submit" value="1">
          {t('Cart.updateQuantity')}
        </button>
      )}

      {!removeOnly && (
        <div
          className={cn(
            'inline-flex h-9 items-stretch rounded-(--radius-control) border border-border',
            isPending && 'opacity-60',
          )}
        >
          <button
            aria-label={t('Product.decreaseQuantity')}
            className="w-8 text-lg leading-none transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isPending}
            name="delta"
            type="submit"
            value="-1"
          >
            &minus;
          </button>

          <input
            aria-label={t('Cart.quantityFor', { name })}
            className="w-12 border-x border-border bg-background text-center text-sm tabular-nums outline-none focus-visible:bg-accent"
            defaultValue={quantity}
            disabled={isPending}
            inputMode="numeric"
            min={0}
            name="quantity"
            type="number"
          />

          <button
            aria-label={t('Product.increaseQuantity')}
            className="w-8 text-lg leading-none transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isPending}
            name="delta"
            type="submit"
            value="1"
          >
            +
          </button>
        </div>
      )}

      <button
        aria-label={t('Cart.removeItem', { name })}
        className="text-sm text-muted underline underline-offset-4 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isPending}
        name="remove"
        type="submit"
        value="1"
      >
        {t('Cart.remove')}
      </button>

      {errors.length > 0 && (
        <p className="text-sm text-error" role="alert">
          {errors.join(' ')}
        </p>
      )}
    </form>
  );
}
