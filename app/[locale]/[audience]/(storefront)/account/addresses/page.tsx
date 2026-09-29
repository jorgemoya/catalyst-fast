import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';

import { getAddresses } from '~/data/customer/addresses';

import { AddressBook } from './_components/address-book';
import { getFormFields } from '~/data/form-fields';
import { getCountries } from '~/data/geography';

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

    // Countries drive the address form's country/state selects. Cached, so this
  // costs no origin request on all but the first render of the window.
  const [{ address: customFields }, countries] = await Promise.all([
    getFormFields(),
    getCountries(),
  ]);

  return <AddressBook addresses={addresses} countries={countries} customFields={customFields} />;
}
