'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { t } from '~/lib/i18n/messages';

/**
 * The search box on `/search`.
 *
 * A real `<form method="get" action="/search">`, so it works with JavaScript
 * disabled — the browser builds `?term=…` itself. With JS, submission is
 * intercepted and routed through `router.push`, which keeps the client-side
 * navigation and avoids a full document load.
 *
 * The current term is read on the *client* via `useSearchParams`. Reading it on
 * the server would pull the page heading and this field out of the static shell
 * along with everything else, for a value the browser already has.
 */
export function SearchField() {
  const router = useRouter();
  const params = useSearchParams();
  const [term, setTerm] = useState(() => params.get('term') ?? '');

  return (
    <form
      action="/search"
      className="flex gap-2"
      method="get"
      onSubmit={(event) => {
        event.preventDefault();
        router.push(`/search?term=${encodeURIComponent(term.trim())}`);
      }}
      role="search"
    >
      <input
        aria-label={t('Search.label')}
        autoComplete="off"
        className="h-11 flex-1 rounded-(--radius-control) border border-border bg-background px-3 text-sm"
        name="term"
        onChange={(event) => setTerm(event.target.value)}
        placeholder={t('Search.placeholder')}
        type="search"
        value={term}
      />
      <button
        className="h-11 rounded-(--radius-control) bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        type="submit"
      >
        {t('Search.submit')}
      </button>
    </form>
  );
}
