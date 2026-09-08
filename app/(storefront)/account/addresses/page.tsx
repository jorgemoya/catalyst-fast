import type { Metadata } from 'next';

import { getAddresses } from '~/data/customer/addresses';
import { t } from '~/lib/i18n/messages';

import { AddressBook } from './_components/address-book';

export const metadata: Metadata = {
  title: t('Auth.addresses'),
  robots: { index: false, follow: false },
};

export default async function AddressesPage() {
  const addresses = await getAddresses();

  return <AddressBook addresses={addresses} />;
}
