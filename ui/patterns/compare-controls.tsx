'use client';

import { useTranslations } from 'next-intl';

import { useActionState, useState, useSyncExternalStore } from 'react';

import { addToCart } from '~/app/[locale]/(storefront)/product/[id]/_actions/add-to-cart';
import {
  MAX_COMPARE_SELECTION,
  compareHref,
  parseCompareIds,
  serializeCompareIds,
  toggleCompare,
} from '~/domain/compare-selection';
import { Link } from '~/ui/primitives/link';

/**
 * Compare selection: the checkbox on a product card, and the drawer summarising
 * what is selected.
 *
 * **Selection lives in `sessionStorage`, not in the URL.** It is interaction
 * state — a shopper ticking boxes while browsing — and putting it in a search
 * param would make it part of the listing's cache key, so every distinct
 * selection would fragment the PLP cache that Phase 2 exists to protect. It only
 * becomes a URL when the shopper commits, by following the link to `/compare/`,
 * which is exactly where a shareable URL starts being useful.
 *
 * `sessionStorage` rather than `localStorage`: a comparison is scoped to a
 * shopping session. Finding last week's selection still ticked is confusing, and
 * there is no way to discover how to clear it.
 */

const STORAGE_KEY = 'cf.compare';

/*
 * One store shared by every checkbox and the drawer, so ticking a box on a card
 * updates the drawer without either knowing about the other. `useSyncExternalStore`
 * for the same reason as the consent banner: it reads browser-only state with a
 * separate server snapshot, so there is no hydration mismatch and no setState in
 * an effect.
 */
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // `storage` fires for changes made in *other* tabs; the local `emit` covers
  // this one.
  window.addEventListener('storage', listener);

  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

const getSnapshot = (): string => window.sessionStorage.getItem(STORAGE_KEY) ?? '';
const getServerSnapshot = (): string => '';

function write(ids: readonly number[]): void {
  window.sessionStorage.setItem(STORAGE_KEY, serializeCompareIds(ids));
  emit();
}

function useCompareSelection(): number[] {
  return parseCompareIds(useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot));
}

/**
 * The per-product checkbox, rendered on product cards.
 *
 * Returns null when the merchant has comparisons switched off — the caller
 * passes `enabled` from cached store settings, so this costs no extra read.
 */
export function CompareCheckbox({
  enabled,
  productId,
  productName,
}: {
  enabled: boolean;
  productId: number;
  productName: string;
}) {
  const t = useTranslations();

  const selection = useCompareSelection();

  if (!enabled) {
    return null;
  }

  const checked = selection.includes(productId);
  const atCap = !checked && selection.length >= MAX_COMPARE_SELECTION;

  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        aria-label={`${t('Compare.compare')} ${productName}`}
        checked={checked}
        // Disabled rather than silently ignored at the cap, so the limit is
        // visible before the click rather than after it does nothing.
        disabled={atCap}
        onChange={() => write(toggleCompare(selection, productId))}
        type="checkbox"
      />
      <span className={atCap ? 'text-muted' : undefined}>{t('Compare.compare')}</span>
    </label>
  );
}

/**
 * Floating summary of the current selection.
 *
 * Renders nothing until at least two products are selected: comparing one
 * product against nothing is not a comparison, and a bar that appears on the
 * first tick is in the way for the whole session.
 */
export function CompareDrawer({ enabled }: { enabled: boolean }) {
  const t = useTranslations();

  const selection = useCompareSelection();

  if (!enabled || selection.length < 2) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background p-3">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
        <span className="text-sm">
          {t('Compare.compareSelected', { count: selection.length })}
        </span>

        <div className="flex items-center gap-2">
          <button
            className="rounded-(--radius-control) border border-border px-3 py-2 text-sm hover:bg-accent"
            onClick={() => write([])}
            type="button"
          >
            {t('Compare.clearSelection')}
          </button>
          <Link
            className="rounded-(--radius-control) bg-foreground px-3 py-2 text-sm text-background"
            href={compareHref(selection)}
          >
            {t('Compare.title')}
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * The buy control in a comparison column.
 *
 * A product with options cannot be added from here — BigCommerce rejects an
 * add-to-cart with no variant selected, and a comparison table has nowhere to
 * present a swatch picker. Linking to the PDP is the honest affordance; Catalyst
 * makes the same call.
 */
export function AddToCompareButton({
  productId,
  path,
  hasOptions,
  inStock,
}: {
  productId: number;
  path: string;
  hasOptions: boolean;
  inStock: boolean;
}) {
  const t = useTranslations();

  const [result, action, pending] = useActionState(addToCart.bind(null, productId), null);
  const [added, setAdded] = useState(false);

  if (hasOptions) {
    return (
      <Link
        className="inline-block rounded-(--radius-control) border border-border px-3 py-2 text-sm hover:bg-accent"
        href={path}
      >
        {t('Compare.viewOptions')}
      </Link>
    );
  }

  if (!inStock) {
    return <span className="text-sm text-muted">{t('Compare.outOfStock')}</span>;
  }

  return (
    <form
      action={action}
      onSubmit={() => {
        setAdded(true);
      }}
    >
      <input name="quantity" type="hidden" value="1" />
      <button
        className="rounded-(--radius-control) bg-foreground px-3 py-2 text-sm text-background disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {t('Compare.addToCart')}
      </button>
      {added && result?.status === 'error'
        ? Object.values(result.error ?? {})
            .flat()
            .slice(0, 1)
            .map((message) => (
              <p className="mt-1 text-sm text-danger" key={String(message)}>
                {String(message)}
              </p>
            ))
        : null}
    </form>
  );
}
