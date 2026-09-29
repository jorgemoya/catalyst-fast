'use client';

import { useLocale, useTranslations } from 'next-intl';

import { useActionState, useState } from 'react';

import {
  type EstimateState,
  cancelShippingEstimate,
  estimateShippingCost,
  selectShippingMethod,
} from '../_actions/shipping';

import type { Country } from '~/data/geography';
import type { ShippingOption } from '~/lib/cart/shipping';
import { formatCurrencyIn } from '~/lib/i18n/messages';

/**
 * Shipping estimator.
 *
 * The country list is passed in from a cached Server Component rather than
 * fetched here — it is the same `getCountries()` entry every address form uses,
 * so it costs no origin request, and shipping ~250 countries with their states
 * as props is far cheaper than a client fetch on mount.
 *
 * The state dropdown is driven off the selected country's own list rather than a
 * second request, for the same reason: the data is already here.
 */
export function ShippingEstimator({ countries }: { countries: Country[] }) {
  const t = useTranslations();

  const [result, action, pending] = useActionState(estimateShippingCost, null);
  const [countryCode, setCountryCode] = useState('');
  const [editing, setEditing] = useState(true);

  const country = countries.find((candidate) => candidate.code === countryCode);

  /*
   * Three states, not two. The form collapses on submit, but the result only
   * exists once the action resolves — so `!editing && result` left a window in
   * which the section rendered nothing but its heading. On a cold consignment
   * that is a second or more of the panel appearing to have swallowed the
   * submission.
   *
   * Caught by an e2e that silently *skipped* rather than failed: it sampled the
   * empty window and read it as "this store quotes no options".
   */
  const showResult = !editing && result !== null;
  const showPending = !editing && result === null;

  return (
    <section className="mt-6 border-t border-border pt-6">
      <h2 className="mb-3 text-sm font-semibold">{t('Cart.shippingEstimate')}</h2>

      {editing ? (
        <form
          action={action}
          className="flex flex-col gap-3"
          onSubmit={() => {
            // Collapses to the result view once submitted; the action's own
            // pending state covers the interval.
            setEditing(false);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            {t('Cart.shippingCountry')}
            <select
              className="rounded-(--radius-control) border border-border p-2"
              name="countryCode"
              onChange={(event) => setCountryCode(event.target.value)}
              value={countryCode}
            >
              <option value="">{t('Cart.shippingChooseCountry')}</option>
              {countries.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>

          {/* Only rendered when the selected country actually has states —
              showing an empty dropdown implies missing data. */}
          {country && country.states.length > 0 ? (
            <label className="flex flex-col gap-1 text-sm">
              {t('Cart.shippingState')}
              <select className="rounded-(--radius-control) border border-border p-2" name="state">
                <option value="">{t('Cart.shippingChooseState')}</option>
                {country.states.map((state) => (
                  <option key={state.id} value={state.abbreviation || state.name}>
                    {state.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-sm">
            {t('Cart.shippingCity')}
            <input
              className="rounded-(--radius-control) border border-border p-2"
              name="city"
              type="text"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            {t('Cart.shippingPostalCode')}
            <input
              autoComplete="postal-code"
              className="rounded-(--radius-control) border border-border p-2"
              name="postalCode"
              type="text"
            />
          </label>

          <button
            className="self-start rounded-(--radius-control) border border-border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
            disabled={pending}
            type="submit"
          >
            {pending ? t('Cart.shippingEstimating') : t('Cart.shippingEstimateSubmit')}
          </button>
        </form>
      ) : null}

      {showPending ? (
        // Matches the button's own label so the wording does not change under
        // the shopper mid-request.
        <p className="text-sm text-muted" data-testid="shipping-pending" role="status">
          {t('Cart.shippingEstimating')}
        </p>
      ) : null}

      {showResult ? (
        <div className="flex flex-col gap-3">
          <EstimateResult state={result} />

          <button
            className="self-start rounded-(--radius-control) border border-border px-3 py-2 text-sm hover:bg-accent"
            onClick={() => {
              /*
               * Drops the consignment on the server as well as reopening the
               * form. Leaving it attached would carry a shipping method the
               * shopper never chose into the real checkout.
               */
              void cancelShippingEstimate();
              setEditing(true);
            }}
            type="button"
          >
            {t('Cart.shippingEdit')}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function EstimateResult({ state }: { state: EstimateState }) {
  const t = useTranslations();

  if (state.status === 'error') {
    return (
      <p className="text-sm text-danger" role="alert">
        {state.message}
      </p>
    );
  }

  // Distinct from an error: the address is fine, the store just does not ship
  // there.
  if (state.status === 'none') {
    return <p className="text-sm text-muted">{t('Cart.shippingNone')}</p>;
  }

  return <ShippingOptions options={state.options ?? []} />;
}

/**
 * The quotes, as a choice rather than a readout.
 *
 * They used to render as a plain `<ul>`: a shopper could see that Express costs
 * more and had no way to take it, so the consignment kept whatever BigCommerce
 * had defaulted to. Radios plus an explicit apply, because changing the shipping
 * method changes the order total — that should be a deliberate act, not a
 * side effect of clicking a row.
 */
function ShippingOptions({ options }: { options: ShippingOption[] }) {
  const t = useTranslations();
  const activeLocale = useLocale();
  const [state, action, pending] = useActionState(selectShippingMethod, null);
  const [chosen, setChosen] = useState(options[0]?.id ?? '');

  const selected = options.find((option) => option.id === chosen);

  return (
    <form action={action}>
      <h3 className="mb-2 text-sm font-medium">{t('Cart.shippingOptions')}</h3>

      {/* The consignment the chosen option belongs to — the mutation needs both. */}
      <input name="consignmentId" type="hidden" value={selected?.consignmentId ?? ''} />
      <input name="optionId" type="hidden" value={chosen} />

      <ul className="flex flex-col gap-1 text-sm">
        {options.map((option) => (
          <li key={option.id}>
            <label className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-2">
                <input
                  checked={chosen === option.id}
                  className="size-4"
                  disabled={pending}
                  name="shippingOption"
                  onChange={() => setChosen(option.id)}
                  type="radio"
                  value={option.id}
                />
                {option.description}
              </span>
              <span>
                {formatCurrencyIn(activeLocale, option.cost.value, option.cost.currencyCode)}
              </span>
            </label>
          </li>
        ))}
      </ul>

      <button
        className="mt-3 rounded-(--radius-control) border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-60"
        data-testid="apply-shipping"
        disabled={pending || chosen === ''}
        type="submit"
      >
        {pending ? t('Cart.shippingApplying') : t('Cart.shippingApply')}
      </button>

      {state?.message !== undefined && (
        <p
          className={state.status === 'error' ? 'mt-2 text-sm text-error' : 'mt-2 text-sm text-in-stock'}
          role="status"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
