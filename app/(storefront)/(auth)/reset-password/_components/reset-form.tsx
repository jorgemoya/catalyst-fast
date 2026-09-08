'use client';

import { useActionState } from 'react';

import { t } from '~/lib/i18n/messages';
import { TextField } from '~/ui/patterns/form-field';
import { Link } from '~/ui/primitives/link';

import { resetPassword } from '../../_actions/password';

/**
 * The token and customer id come from the emailed link and ride in hidden
 * inputs. They are not a secret the *shopper* must be prevented from seeing —
 * they arrived in their own inbox — but they are validated by BigCommerce, which
 * is the only party that can tell whether the pair is genuine and unexpired.
 */
export function ResetPasswordForm({ customerId, token }: { customerId: string; token: string }) {
  const [result, formAction, isPending] = useActionState(resetPassword, null);
  const errors = result?.error ?? {};
  const formErrors = errors[''] ?? [];
  const done = result?.status === 'success';

  if (done) {
    return (
      <div className="mt-6" data-testid="reset-done">
        <p className="text-sm text-in-stock" role="status">
          {t('Auth.resetDone')}
        </p>
        <Link
          className="mt-4 inline-flex h-11 items-center rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground"
          href="/login"
        >
          {t('Auth.signIn')}
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="mt-6 flex max-w-sm flex-col gap-4">
      <input name="customerId" type="hidden" value={customerId} />
      <input name="token" type="hidden" value={token} />

      <TextField autoComplete="new-password" errors={errors.password} label={t('Auth.newPassword')} name="password" required type="password" />
      <TextField autoComplete="new-password" errors={errors.confirmPassword} label={t('Auth.confirmPassword')} name="confirmPassword" required type="password" />

      {formErrors.length > 0 && (
        <p className="text-sm text-error" data-testid="reset-error" role="alert">
          {formErrors.join(' ')}
        </p>
      )}

      <button
        className="h-11 self-start rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {t('Auth.resetPassword')}
      </button>
    </form>
  );
}
