'use client';

import { useTranslations } from 'next-intl';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

import { SORT_OPTIONS } from '~/domain/listing-params';

/**
 * The one client island on the listing page.
 *
 * A `<select>` can't navigate on change without JS, and a submit button next to
 * a sort dropdown is clumsy — so this is the single interaction that earns a
 * boundary. It's ~30 lines and takes no data: options are a static constant, and
 * current state comes from `useSearchParams`.
 *
 * Reading search params on the *client* does not make the server render dynamic,
 * which is what lets the surrounding page keep its static shell.
 */
export function SortSelect({ defaultSort = 'featured' }: { defaultSort?: string }) {
  const t = useTranslations();

  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const current = searchParams.get('sort') ?? defaultSort;

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted">{t('Listing.sort')}</span>
      <select
        className="h-9 rounded-(--radius-control) border border-border bg-background px-2 text-sm disabled:opacity-60"
        disabled={isPending}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams);

          if (event.target.value === defaultSort) {
            // Keep the URL on the canonical unfiltered form so it shares the
            // prerendered entry rather than minting a new cache key.
            params.delete('sort');
          } else {
            params.set('sort', event.target.value);
          }

          // Changing sort reorders the whole result set, so cursors are stale.
          params.delete('after');
          params.delete('before');

          startTransition(() => {
            router.push(`?${params.toString()}`, { scroll: false });
          });
        }}
        value={current}
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
