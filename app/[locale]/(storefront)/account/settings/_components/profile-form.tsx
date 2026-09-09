'use client';

import { useTranslations } from 'next-intl';

import { useActionState } from 'react';

import type { CustomerProfile } from '~/data/customer/customer';

import { updateProfile } from '../_actions/update-profile';

const inputClass =
  'h-10 w-full rounded-(--radius-control) border border-border bg-background px-2 text-sm';

export function ProfileForm({ profile }: { profile: CustomerProfile }) {
  const t = useTranslations();

  const [result, formAction, isPending] = useActionState(updateProfile, null);
  const errors = result?.error ?? {};
  const formErrors = errors[''] ?? [];
  const saved = result?.status === 'success';

  return (
    <form action={formAction} className="flex max-w-lg flex-col gap-4">
      <Field defaultValue={profile.firstName} errors={errors.firstName} label={t('Account.firstName')} name="firstName" required />
      <Field defaultValue={profile.lastName} errors={errors.lastName} label={t('Account.lastName')} name="lastName" required />
      <Field defaultValue={profile.email} errors={errors.email} label={t('Auth.email')} name="email" required type="email" />
      <Field defaultValue={profile.company} errors={errors.company} label={t('Account.company')} name="company" />
      <Field defaultValue={profile.phone} errors={errors.phone} label={t('Account.phone')} name="phone" type="tel" />

      <button
        className="h-11 self-start rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {isPending ? t('Account.saving') : t('Account.save')}
      </button>

      {formErrors.length > 0 && (
        <p className="text-sm text-error" role="alert">
          {formErrors.join(' ')}
        </p>
      )}
      {saved && (
        <p className="text-sm text-in-stock" data-testid="profile-saved" role="status">
          {t('Account.saved')}
        </p>
      )}
    </form>
  );
}

function Field({
  name,
  label,
  defaultValue,
  errors,
  required,
  type = 'text',
}: {
  name: string;
  label: string;
  defaultValue?: string;
  errors?: string[] | null;
  required?: boolean;
  type?: string;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium" htmlFor={name}>
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      <input
        className={inputClass}
        defaultValue={defaultValue}
        id={name}
        name={name}
        required={required}
        type={type}
      />
      {errors && errors.length > 0 && (
        <p className="mt-1 text-sm text-error" role="alert">
          {errors.join(' ')}
        </p>
      )}
    </div>
  );
}
