'use client';

import { useTranslations } from 'next-intl';

import { useActionState } from 'react';

import { TextField } from '~/ui/patterns/form-field';

import { changePassword } from '../../../(auth)/_actions/password';

export function ChangePasswordForm() {
  const t = useTranslations();

  const [result, formAction, isPending] = useActionState(changePassword, null);
  const errors = result?.error ?? {};
  const formErrors = errors[''] ?? [];
  const changed = result?.status === 'success';

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <TextField autoComplete="current-password" errors={errors.currentPassword} label={t('Auth.currentPassword')} name="currentPassword" required type="password" />
      <TextField autoComplete="new-password" errors={errors.password} label={t('Auth.newPassword')} name="password" required type="password" />
      <TextField autoComplete="new-password" errors={errors.confirmPassword} label={t('Auth.confirmPassword')} name="confirmPassword" required type="password" />

      {formErrors.length > 0 && (
        <p className="text-sm text-error" role="alert">
          {formErrors.join(' ')}
        </p>
      )}
      {changed && (
        <p className="text-sm text-in-stock" data-testid="password-changed" role="status">
          {t('Auth.passwordChanged')}
        </p>
      )}

      <button
        className="h-11 self-start rounded-(--radius-control) border border-border px-6 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {isPending ? t('Account.saving') : t('Auth.changePassword')}
      </button>
    </form>
  );
}
