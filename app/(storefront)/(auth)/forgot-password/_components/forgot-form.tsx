'use client';

import { useActionState } from 'react';

import { t } from '~/lib/i18n/messages';
import { TextField } from '~/ui/patterns/form-field';

import { requestPasswordReset } from '../../_actions/password';

export function ForgotPasswordForm() {
  const [result, formAction, isPending] = useActionState(requestPasswordReset, null);
  const errors = result?.error ?? {};
  const sent = result?.status === 'success';

  // Deliberately the same message whether or not the address exists — see the
  // action. Showing it in place of the form also stops repeated submissions
  // being used to probe for registered addresses.
  if (sent) {
    return (
      <p className="mt-6 text-sm text-in-stock" data-testid="reset-sent" role="status">
        {t('Auth.resetSent')}
      </p>
    );
  }

  return (
    <form action={formAction} className="mt-6 flex max-w-sm flex-col gap-4">
      <TextField autoComplete="email" errors={errors.email} label={t('Auth.email')} name="email" required type="email" />

      <button
        className="h-11 self-start rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {isPending ? t('Auth.sending') : t('Auth.sendReset')}
      </button>
    </form>
  );
}
