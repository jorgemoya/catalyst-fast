'use client';

import { Dialog } from '@base-ui/react/dialog';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { searchSuggestions } from '~/app/(storefront)/search/_actions/suggest';
import { MIN_QUERY_LENGTH, type Suggestion } from '~/domain/suggestions';
import { t } from '~/lib/i18n/messages';
import { Image } from '~/ui/primitives/image';

/**
 * Quick search.
 *
 * Its own island, mounted independently of the nav and the cart badge. Catalyst
 * folded search, the mega-menu, locale and currency switchers, and the mobile
 * drawer into one 1056-line `'use client'` component, so a shopper who never
 * opened search still downloaded and hydrated all of it.
 *
 * Suggestions come from a Server Function reading the same cached
 * `searchListing` entry the results page uses, so typing a popular term is a
 * cache hit and pressing Enter lands on an already-warm page.
 */

/** Long enough that a fast typist produces one request per word, not per letter. */
const DEBOUNCE_MS = 200;

export function SearchMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const query = term.trim();

  /*
   * Whether to show anything is **derived, not stored**. Clearing state in the
   * effect when the query got too short would be a synchronous setState in an
   * effect — a cascading render, and the rule React's lint enforces. The list is
   * only ever *set* from a server response below.
   */
  const visible = query.length >= MIN_QUERY_LENGTH ? suggestions : [];

  /*
   * Debounced suggestion fetch, with two independent guards:
   *
   *  - `clearTimeout` means only the last term in a typing burst is ever sent.
   *  - `ignore` means a response that *is* already in flight when the shopper
   *    keeps typing cannot overwrite newer results. The timer alone doesn't
   *    cover this: a request fired 190ms ago is past the debounce and will still
   *    resolve, out of order, after a faster one for a later term.
   */
  useEffect(() => {
    if (query.length < MIN_QUERY_LENGTH) {
      return;
    }

    let ignore = false;

    const timer = setTimeout(() => {
      startTransition(async () => {
        const results = await searchSuggestions(query);

        if (!ignore) {
          setSuggestions(results);
        }
      });
    }, DEBOUNCE_MS);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [query]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();

    if (!query) {
      return;
    }

    setOpen(false);
    router.push(`/search?term=${encodeURIComponent(query)}`);
  };

  const showEmpty = query.length >= MIN_QUERY_LENGTH && !isPending && visible.length === 0;

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Trigger
        aria-label={t('Header.search')}
        className="inline-flex size-9 items-center justify-center rounded-(--radius-control) hover:bg-accent"
      >
        <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
          <path d="m20 20-3.5-3.5" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-(--duration-fast) data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          className="fixed inset-x-0 top-0 z-50 bg-background p-6 shadow-lg transition-transform duration-(--duration-fast) ease-(--ease-out-quart) data-ending-style:-translate-y-4 data-starting-style:-translate-y-4"
          // Focus the input rather than the dialog itself: the shopper opened
          // search to type.
          initialFocus={inputRef}
        >
          <div className="page-container">
            <Dialog.Title className="sr-only">{t('Header.search')}</Dialog.Title>

            <form className="flex gap-2" onSubmit={submit} role="search">
              <input
                aria-label={t('Search.label')}
                autoComplete="off"
                className="h-11 flex-1 rounded-(--radius-control) border border-border bg-background px-3 text-sm"
                onChange={(event) => setTerm(event.target.value)}
                placeholder={t('Search.placeholder')}
                ref={inputRef}
                type="search"
                value={term}
              />
              <Dialog.Close
                aria-label={t('Header.closeSearch')}
                className="inline-flex size-11 items-center justify-center rounded-(--radius-control) hover:bg-accent"
              >
                <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
                  <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
                </svg>
              </Dialog.Close>
            </form>

            {visible.length > 0 && (
              <ul className="mt-4 flex flex-col" data-testid="search-suggestions">
                {visible.map((suggestion) => (
                  <li key={suggestion.id}>
                    <a
                      className="flex items-center gap-3 rounded-(--radius-control) p-2 hover:bg-accent"
                      href={suggestion.href}
                    >
                      <span className="size-10 shrink-0 overflow-hidden rounded-(--radius-control) bg-accent">
                        {suggestion.image && (
                          <Image
                            alt={suggestion.image.alt}
                            className="size-full object-cover"
                            height={40}
                            sizes="40px"
                            src={suggestion.image.src}
                            width={40}
                          />
                        )}
                      </span>
                      <span className="text-sm">{suggestion.title}</span>
                    </a>
                  </li>
                ))}

                <li className="mt-2 border-t border-border pt-2">
                  <button
                    className="p-2 text-sm font-medium text-primary hover:underline"
                    onClick={submit}
                    type="button"
                  >
                    {t('Search.viewAll', { term: query })}
                  </button>
                </li>
              </ul>
            )}

            {showEmpty && (
              <p className="mt-4 p-2 text-sm text-muted">
                {t('Search.emptySubtitle', { term: query })}
              </p>
            )}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
