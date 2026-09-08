'use client';

import { useSearchParams } from 'next/navigation';
import { useActionState } from 'react';

import { t } from '~/lib/i18n/messages';
import { Link } from '~/ui/primitives/link';

import { login } from '../../_actions/login';

/**
 * Sign-in form.
 *
 * `redirectTo` rides along in a hidden input rather than being read on the
 * server, which keeps the surrounding page prerenderable. It is validated
 * server-side by `safeRedirectPath` regardless — a hidden input is shopper-
 * editable, so the client is never the guard.
 */
const inputClass =
  'h-10 w-full rounded-(--radius-control) border border-border bg-background px-2 text-sm';

export function LoginForm() {
  const params = useSearchParams();
  const [result, formAction, isPending] = useActionState(login, null);

  const errors = result?.error ?? {};
  const formErrors = errors[''] ?? [];

  return (
    <form action={formAction} className="mt-6 flex flex-col gap-4">
      <input name="redirectTo" type="hidden" value={params.get('redirectTo') ?? ''} />

      <div>
        <label className="mb-2 block text-sm font-medium" htmlFor="email">
          {t('Auth.email')}
        </label>
        <input
          autoComplete="email"
          className={inputClass}
          id="email"
          name="email"
          required
          type="email"
        />
        {errors.email && <p className="mt-1 text-sm text-error">{errors.email.join(' ')}</p>}
      </div>

      <div>
        <label className="mb-2 block text-sm font-medium" htmlFor="password">
          {t('Auth.password')}
        </label>
        <input
          autoComplete="current-password"
          className={inputClass}
          id="password"
          name="password"
          required
          type="password"
        />
        {errors.password && <p className="mt-1 text-sm text-error">{errors.password.join(' ')}</p>}
      </div>

      {formErrors.length > 0 && (
        <p className="text-sm text-error" data-testid="login-error" role="alert">
          {formErrors.join(' ')}
        </p>
      )}

      <button
        className="h-11 self-start rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {isPending ? t('Auth.signingIn') : t('Auth.signIn')}
      </button>

      <Link className="text-sm text-muted underline underline-offset-4" href="/forgot-password">
        {t('Auth.forgotPassword')}
      </Link>
    </form>
  );
}
