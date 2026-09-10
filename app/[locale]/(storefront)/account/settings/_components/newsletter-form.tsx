'use client';

import { useTranslations } from 'next-intl';
import { useActionState, useState } from 'react';

import { setNewsletterSubscription } from '../_actions/newsletter-subscription';

/**
 * Newsletter opt-in/out.
 *
 * A form with an explicit save rather than a checkbox that fires on change: an
 * accidental click should not silently alter a marketing preference, and a
 * fire-on-change control gives no way to say whether it worked.
 *
 * `subscribed` is seeded from the server-rendered profile and then owned locally,
 * so the checkbox stays where the shopper put it while the action is in flight
 * rather than snapping back.
 */
export function NewsletterForm({ subscribed }: { subscribed: boolean }) {
  const t = useTranslations();
  const [state, formAction, isPending] = useActionState(setNewsletterSubscription, null);
  const [checked, setChecked] = useState(subscribed);

  return (
    <form action={formAction} className="flex flex-col items-start gap-4">
      <label className="flex items-center gap-3 text-sm">
        <input
          checked={checked}
          className="size-4 rounded-sm border-border"
          data-testid="newsletter-toggle"
          disabled={isPending}
          name="subscribed"
          onChange={(event) => setChecked(event.target.checked)}
          type="checkbox"
        />
        {t('Account.newsletterLabel')}
      </label>

      <button
        className="h-11 rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {isPending ? t('Account.newsletterSaving') : t('Account.newsletterSave')}
      </button>

      {state?.message !== undefined && (
        <p
          className={state.status === 'error' ? 'text-sm text-error' : 'text-sm text-in-stock'}
          data-testid="newsletter-result"
          role="status"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
