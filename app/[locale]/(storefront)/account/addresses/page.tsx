import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';

import { getAddresses } from '~/data/customer/addresses';

import { AddressBook } from './_components/address-book';

/** Translated, so it must be generated per request rather than at import. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return {
  title: t('Auth.addresses'),
  robots: { index: false, follow: false },
  };
}

export default async function AddressesPage() {
  const addresses = await getAddresses();

  return <AddressBook addresses={addresses} />;
}
