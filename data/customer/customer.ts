import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { customerQuery } from '~/lib/bigcommerce/customer';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

import { getSession } from './session';

/**
 * Customer-scoped reads.
 *
 * **Every function here is `'use cache: private'` or plain dynamic — never a
 * public cache.** A public scope keys across identities, so one customer's
 * profile could be served to another; `scripts/cache-audit.ts` fails the build if
 * anything under `data/customer/` uses a bare `'use cache'`.
 *
 * What `'use cache: private'` buys, given it is never stored on the server: it
 * dedupes within a render, keeps the scope prefetchable, and is the legal place
 * to read `cookies()` — which is how these functions get a session at all. It is
 * not a per-user server cache and must not be reasoned about as one.
 */

const CustomerProfileQuery = graphql(`
  query CustomerProfile {
    customer {
      entityId
      firstName
      lastName
      email
      company
      phone
      customerGroupId
      isSubscribedToNewsletter
    }
  }
`);

export interface CustomerProfile {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  company: string;
  phone: string;
  customerGroupId: number;
  isSubscribedToNewsletter: boolean;
}

export async function getCustomerProfile(): Promise<CustomerProfile | null> {
  'use cache: private';
  // 30s keeps the scope prefetchable (MIN_PREFETCHABLE_STALE) without holding a
  // stale name after the shopper edits their profile.
  cacheLife({ stale: 30 });

  const session = await getSession();

  if (!session) {
    return null;
  }

  cacheTag(tags.customer(session.customerId));

  const data = await customerQuery({
    document: CustomerProfileQuery,
    customerAccessToken: session.customerAccessToken,
  });

  const customer = data.customer;

  if (!customer) {
    return null;
  }

  return {
    id: customer.entityId,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    company: customer.company,
    phone: customer.phone,
    customerGroupId: customer.customerGroupId,
    isSubscribedToNewsletter: customer.isSubscribedToNewsletter,
  };
}
