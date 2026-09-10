'use client';

import { useTranslations } from 'next-intl';

import { useActionState, useEffect, useState } from 'react';

import type { CustomerAddress } from '~/data/customer/addresses';
import type { Country } from '~/data/geography';
import type { CustomFormField } from '~/domain/form-fields';
import { CustomFields } from '~/ui/patterns/custom-fields';
import { TextField } from '~/ui/patterns/form-field';

import { deleteAddress, saveAddress } from '../_actions/address';

/**
 * The address book: list, add, edit, delete.
 *
 * Client-side only for *which* form is open — the data comes from the server and
 * every change round-trips through an action. `editing` holds an id rather than a
 * copy of the address, so a re-render after a save shows the server's version
 * rather than a stale local one.
 */
export function AddressBook({
  addresses,
  countries,
  customFields,
}: {
  addresses: CustomerAddress[];
  countries: Country[];
  customFields: CustomFormField[];
}) {
  const t = useTranslations();

  const [editing, setEditing] = useState<number | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-6">
      {editing === null && (
        <button
          className="h-11 self-start rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          onClick={() => setEditing('new')}
          type="button"
        >
          {t('Account.addAddress')}
        </button>
      )}

      {editing === 'new' && (
        <AddressForm
          countries={countries}
          customFields={customFields}
          onDone={() => setEditing(null)}
        />
      )}

      {addresses.length === 0 && editing === null ? (
        <div className="rounded-(--radius-card) border border-border py-16 text-center">
          <h2 className="text-lg font-semibold">{t('Account.noAddressesTitle')}</h2>
          <p className="mt-2 text-sm text-muted">{t('Account.noAddressesSubtitle')}</p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2" data-testid="addresses">
          {addresses.map((address) =>
            editing === address.id ? (
              <li className="sm:col-span-2" key={address.id}>
                <AddressForm
                  address={address}
                  countries={countries}
                  customFields={customFields}
                  onDone={() => setEditing(null)}
                />
              </li>
            ) : (
              <li className="rounded-(--radius-card) border border-border p-4 text-sm" key={address.id}>
                <p className="font-medium">
                  {address.firstName} {address.lastName}
                </p>
                {address.company && <p className="text-muted">{address.company}</p>}
                <p className="mt-1 text-muted">{address.address1}</p>
                {address.address2 && <p className="text-muted">{address.address2}</p>}
                <p className="text-muted">
                  {[address.city, address.stateOrProvince, address.postalCode]
                    .filter(Boolean)
                    .join(', ')}
                </p>
                <p className="text-muted">{address.country}</p>
                {address.phone && <p className="mt-1 text-muted">{address.phone}</p>}

                <div className="mt-3 flex gap-3">
                  <button
                    className="text-sm text-primary underline underline-offset-4"
                    onClick={() => setEditing(address.id)}
                    type="button"
                  >
                    {t('Account.editAddress')}
                  </button>
                  <DeleteAddressButton id={address.id} />
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function AddressForm({
  address,
  countries,
  customFields,
  onDone,
}: {
  address?: CustomerAddress;
  countries: Country[];
  customFields: CustomFormField[];
  onDone: () => void;
}) {
  const t = useTranslations();
  const [result, formAction, isPending] = useActionState(saveAddress, null);
  const errors = result?.error ?? {};
  const formErrors = errors[''] ?? [];

  /*
   * Country and state are **selects**, not free text.
   *
   * They were two plain inputs asking a shopper to type a two-letter code — so
   * "United States", "USA" and "us" were all things someone would reasonably
   * enter, and only one of them works. State was free text too, which meant a
   * typo produced an address BigCommerce accepts and a courier cannot deliver.
   *
   * The shipping estimator in this same codebase already did it properly from
   * `getCountries()`; this is the same data and the same pattern.
   */
  const [countryCode, setCountryCode] = useState(address?.countryCode ?? '');
  const country = countries.find((candidate) => candidate.code === countryCode);

  /*
   * Close on success — in an effect, not during render.
   *
   * Calling `onDone()` inline would update the *parent* while this child is
   * rendering, which React rejects ("Cannot update a component while rendering a
   * different component"). This is the case effects are for: reacting to
   * something that already happened, rather than deriving state.
   */
  const succeeded = result?.status === 'success';

  useEffect(() => {
    if (succeeded) {
      onDone();
    }
  }, [succeeded, onDone]);

  return (
    <form action={formAction} className="rounded-(--radius-card) border border-border p-4">
      {address && <input name="addressEntityId" type="hidden" value={address.id} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField defaultValue={address?.firstName} errors={errors.firstName} label={t('Account.firstName')} name="firstName" required />
        <TextField defaultValue={address?.lastName} errors={errors.lastName} label={t('Account.lastName')} name="lastName" required />
        <TextField defaultValue={address?.company ?? ''} errors={errors.company} label={t('Account.company')} name="company" />
        <TextField defaultValue={address?.phone ?? ''} errors={errors.phone} label={t('Account.phone')} name="phone" type="tel" />
        <TextField defaultValue={address?.address1} errors={errors.address1} label={t('Account.address1')} name="address1" required />
        <TextField defaultValue={address?.address2 ?? ''} errors={errors.address2} label={t('Account.address2')} name="address2" />
        <TextField defaultValue={address?.city} errors={errors.city} label={t('Account.city')} name="city" required />
        {/* Only when the country actually has states — an empty dropdown reads
            as missing data rather than as "not applicable here". */}
        {country && country.states.length > 0 ? (
          <label className="flex flex-col gap-1 text-sm font-medium">
            {t('Account.stateOrProvince')}
            <select
              className="rounded-(--radius-control) border border-border p-2 text-sm font-normal"
              defaultValue={address?.stateOrProvince ?? ''}
              disabled={isPending}
              name="stateOrProvince"
            >
              <option value="">{t('Cart.shippingChooseState')}</option>
              {country.states.map((state) => (
                <option key={state.id} value={state.abbreviation || state.name}>
                  {state.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <TextField defaultValue={address?.stateOrProvince ?? ''} errors={errors.stateOrProvince} label={t('Account.stateOrProvince')} name="stateOrProvince" />
        )}
        <TextField defaultValue={address?.postalCode ?? ''} errors={errors.postalCode} label={t('Account.postalCode')} name="postalCode" />
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t('Account.country')}
          <select
            className="rounded-(--radius-control) border border-border p-2 text-sm font-normal"
            disabled={isPending}
            name="countryCode"
            onChange={(event) => setCountryCode(event.target.value)}
            required
            value={countryCode}
          >
            <option value="">{t('Cart.shippingChooseCountry')}</option>
            {countries.map((option) => (
              <option key={option.code} value={option.code}>
                {option.name}
              </option>
            ))}
          </select>
          {errors.countryCode?.map((error) => (
            <p className="text-sm font-normal text-error" key={error}>
              {error}
            </p>
          ))}
        </label>

        {/*
          Inside the same grid as the built-ins, so a merchant's extra fields
          look like part of the address rather than an afterthought bolted on
          below it.
        */}
        <CustomFields disabled={isPending} errors={errors} fields={customFields} />
      </div>

      {formErrors.length > 0 && (
        <p className="mt-3 text-sm text-error" role="alert">
          {formErrors.join(' ')}
        </p>
      )}

      <div className="mt-4 flex gap-3">
        <button
          className="h-11 rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground disabled:opacity-50"
          disabled={isPending}
          type="submit"
        >
          {isPending ? t('Account.saving') : t('Account.save')}
        </button>
        <button
          className="h-11 rounded-(--radius-control) border border-border px-6 text-sm"
          onClick={onDone}
          type="button"
        >
          {t('Account.cancel')}
        </button>
      </div>
    </form>
  );
}

function DeleteAddressButton({ id }: { id: number }) {
  const t = useTranslations();

  const [result, formAction, isPending] = useActionState(deleteAddress, null);
  const errors = result?.error?.[''] ?? [];

  return (
    <form action={formAction} className="inline">
      <input name="addressEntityId" type="hidden" value={id} />
      <button
        className="text-sm text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {t('Account.deleteAddress')}
      </button>
      {errors.length > 0 && (
        <span className="ms-2 text-sm text-error" role="alert">
          {errors.join(' ')}
        </span>
      )}
    </form>
  );
}
