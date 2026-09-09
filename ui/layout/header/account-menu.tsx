import { getT } from '~/lib/i18n/server';
import { cacheLife } from 'next/cache';

import { getSession } from '~/data/customer/session';

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
  const t = await getT();

  const account = await getAccountState();

  if (!account) {
    return <AccountMenuSkeleton label={t('Auth.signIn')} />;
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
 * What the prerendered shell contains, and what a guest keeps: **a link to sign
 * in**. Despite the name it is not a loading placeholder — it is the real
 * signed-out affordance, which is why its label must say "Sign in" rather than
 * anything about an account the visitor does not have.
 *
 * It is also used as the Suspense fallback, so it must **not** be async — a
 * fallback that suspends is the constraint spiked in Phase 0. It therefore
 * cannot call `getT()` and takes its label from the caller, which already has a
 * translator.
 */
export function AccountMenuSkeleton({ label }: { label: string }) {
  return (
    <IconLink href="/login" label={label}>
      <AccountIcon />
    </IconLink>
  );
}
