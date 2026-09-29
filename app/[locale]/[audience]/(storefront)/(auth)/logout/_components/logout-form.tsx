'use client';

import { useTranslations } from 'next-intl';
import { useActionState } from 'react';

import { useDocumentNavigation } from '~/lib/navigation/document-navigation';

import { logout } from '../../_actions/logout';

export function LogoutForm() {
  const t = useTranslations();
  const [result, formAction, isPending] = useActionState(logout, null);

  useDocumentNavigation(result);

  return (
    <form action={formAction}>
      <button
        className="h-11 rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:opacity-50"
        disabled={isPending || result !== null}
        type="submit"
      >
        {t('Auth.signOut')}
      </button>
    </form>
  );
}
