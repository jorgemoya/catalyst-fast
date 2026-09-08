import { cacheLife } from 'next/cache';

import { getSession } from '~/data/customer/session';
import { t } from '~/lib/i18n/messages';

import { AccountIcon, IconLink } from './icon-link';

/**
 * Account chrome.
 *
 * The second per-visitor value in the header, alongside the cart badge, and it
 * follows the same rule: a `'use cache: private'` scope reading the session, so
 * the rest of the header stays in the prerendered shell and only this streams.
 *
 * **This is half of the Phase 6 bar.** A signed-in shopper's page differs from a
 * guest's in exactly two places — this and the price overlay — rather than being
 * a wholly separate, uncached render as it was in Catalyst.
 *
 * No BigCommerce call: the name is already on the session from login, so a
 * signed-in visitor costs *zero* extra origin requests for their own chrome.
 */
async function getAccountState(): Promise<{ name: string; impersonated: boolean } | null> {
  'use cache: private';
  cacheLife({ stale: 30 });

  const session = await getSession();

  if (!session) {
    return null;
  }

  return {
    name: session.firstName || session.email,
    impersonated: session.impersonatorId !== null,
  };
}

export async function AccountMenu() {
  const account = await getAccountState();

  if (!account) {
    return <AccountMenuSkeleton />;
  }

  return (
    <div className="group relative">
      <IconLink href="/account/orders" label={t('Auth.greeting', { name: account.name })}>
        <AccountIcon />
        {account.impersonated && (
          // A B2B agent acting on a customer's behalf must never forget they are
          // doing so — every action here bills a real person.
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-warning"
          />
        )}
      </IconLink>
    </div>
  );
}

/**
 * What the prerendered shell contains, and what a guest keeps: a link to sign in.
 */
export function AccountMenuSkeleton() {
  return (
    <IconLink href="/login" label={t('Auth.signIn')}>
      <AccountIcon />
    </IconLink>
  );
}
