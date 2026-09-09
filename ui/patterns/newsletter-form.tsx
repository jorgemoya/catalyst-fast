'use client';

import { useTranslations } from 'next-intl';

import { useActionState } from 'react';

import { subscribeToNewsletter } from '~/app/[locale]/(storefront)/_actions/newsletter';

/**
 * Newsletter signup.
 *
 * Replaced by the confirmation on success rather than clearing the field: a form
 * that empties itself is ambiguous — it looks the same as a submission that
 * failed silently.
 */
export function NewsletterForm() {
  const t = useTranslations();

  const [result, action, pending] = useActionState(subscribeToNewsletter, null);

  if (result?.status === 'success') {
    return (
      <p className="text-sm" role="status">
        {result.message}
      </p>
    );
  }

  return (
    <form action={action} className="flex w-full max-w-md flex-col gap-2">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="newsletter-email">
          {t('Newsletter.email')}
        </label>
        <input
          autoComplete="email"
          className="min-w-0 flex-1 rounded-(--radius-control) border border-border p-2 text-sm"
          id="newsletter-email"
          name="email"
          placeholder={t('Newsletter.email')}
          required
          type="email"
        />
        <button
          className="shrink-0 rounded-(--radius-control) bg-foreground px-4 py-2 text-sm text-background disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? t('Newsletter.subscribing') : t('Newsletter.subscribe')}
        </button>
      </div>

      {result?.status === 'error' ? (
        <p className="text-sm text-danger" role="alert">
          {result.message}
        </p>
      ) : null}
    </form>
  );
}
