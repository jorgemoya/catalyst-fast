'use client';

import { useTranslations } from 'next-intl';

import { useActionState } from 'react';

import type { CustomFormField } from '~/domain/form-fields';
import { CustomFields } from '~/ui/patterns/custom-fields';
import { TextField } from '~/ui/patterns/form-field';
import { RecaptchaField } from '~/ui/patterns/recaptcha-field';

import { register } from '../../_actions/register';

export function RegisterForm({
  siteKey,
  customFields,
}: {
  siteKey: string | null;
  customFields: CustomFormField[];
}) {
  const t = useTranslations();

  const [result, formAction, isPending] = useActionState(register, null);
  const errors = result?.error ?? {};
  const formErrors = errors[''] ?? [];

  return (
    <form action={formAction} className="mt-6 flex max-w-lg flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField autoComplete="given-name" errors={errors.firstName} label={t('Account.firstName')} name="firstName" required />
        <TextField autoComplete="family-name" errors={errors.lastName} label={t('Account.lastName')} name="lastName" required />
      </div>

      <TextField autoComplete="email" errors={errors.email} label={t('Auth.email')} name="email" required type="email" />
      <TextField autoComplete="organization" errors={errors.company} label={t('Account.company')} name="company" />
      <TextField autoComplete="tel" errors={errors.phone} label={t('Account.phone')} name="phone" type="tel" />
      <TextField autoComplete="new-password" errors={errors.password} label={t('Auth.password')} name="password" required type="password" />
      <TextField autoComplete="new-password" errors={errors.confirmPassword} label={t('Auth.confirmPassword')} name="confirmPassword" required type="password" />

      {/*
        After the built-ins and before the password pair, which is where the
        merchant's own sort order places them relative to everything they can
        actually reorder.
      */}
      <CustomFields disabled={isPending} errors={errors} fields={customFields} />

      {formErrors.length > 0 && (
        <p className="text-sm text-error" data-testid="register-error" role="alert">
          {formErrors.join(' ')}
        </p>
      )}

      {/* Renders nothing when no site key is configured, so an install without
          reCAPTCHA keeps working. */}
      <RecaptchaField siteKey={siteKey} />

      <button
        className="h-11 self-start rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {isPending ? t('Auth.registering') : t('Auth.register')}
      </button>
    </form>
  );
}
