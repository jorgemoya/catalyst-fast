import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import { customerQuery } from '~/lib/bigcommerce/customer';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

import { getSession } from './session';

/** The customer's address book. Private-cached like everything else here. */

const AddressesQuery = graphql(`
  query CustomerAddresses {
    customer {
      addresses(first: 50) {
        edges {
          node {
            entityId
            firstName
            lastName
            company
            address1
            address2
            city
            stateOrProvince
            postalCode
            country
            countryCode
            phone
          }
        }
      }
    }
  }
`);

export interface CustomerAddress {
  id: number;
  firstName: string;
  lastName: string;
  company: string | null;
  address1: string;
  address2: string | null;
  city: string;
  stateOrProvince: string | null;
  postalCode: string | null;
  country: string | null;
  countryCode: string;
  phone: string | null;
}

export async function getAddresses(): Promise<CustomerAddress[]> {
  'use cache: private';
  cacheLife({ stale: 30 });

  const session = await getSession();

  if (!session) {
    return [];
  }

  cacheTag(tags.customer(session.customerId));

  const data = await customerQuery({
    document: AddressesQuery,
    customerAccessToken: session.customerAccessToken,
  });

  const addresses = data.customer?.addresses;

  if (!addresses) {
    return [];
  }

  return removeEdgesAndNodes(addresses).map((address) => ({
    id: address.entityId,
    firstName: address.firstName,
    lastName: address.lastName,
    company: address.company || null,
    address1: address.address1,
    address2: address.address2 || null,
    city: address.city,
    stateOrProvince: address.stateOrProvince || null,
    postalCode: address.postalCode || null,
    country: address.country || null,
    countryCode: address.countryCode,
    phone: address.phone || null,
  }));
}
