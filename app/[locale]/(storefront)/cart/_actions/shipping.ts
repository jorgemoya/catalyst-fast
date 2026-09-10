'use server';

import { getTForAction } from '~/lib/i18n/server';
import { getCountries } from '~/data/geography';
import { AMBIGUOUS_US_ABBREVIATIONS } from '~/data/geography';
import { getCartId } from '~/lib/cart/session';
import {
  type ShippingOption,
  clearShippingConsignments,
  estimateShipping,
  selectShippingOption,
} from '~/lib/cart/shipping';
import { revalidateCart } from '~/lib/cart/revalidate';

/**
 * Shipping estimator actions.
 *
 * A Server Function rather than a form post to a route: the estimate is a
 * refinement of the cart page the shopper is already on, and navigating away and
 * back would lose the rest of their context.
 */

export interface EstimateState {
  status: 'idle' | 'ok' | 'none' | 'error';
  options?: ShippingOption[];
  message?: string;
}

export async function estimateShippingCost(
  _previous: EstimateState | null,
  formData: FormData,
): Promise<EstimateState> {
  const t = await getTForAction();

  const cartId = await getCartId();

  if (!cartId) {
    return { status: 'error', message: t('Cart.shippingEstimateFailed') };
  }

  const countryCode = String(formData.get('countryCode') ?? '').trim();

  if (!countryCode) {
    return { status: 'error', message: t('Cart.shippingCountryRequired') };
  }

  const stateValue = String(formData.get('state') ?? '').trim();
  const city = String(formData.get('city') ?? '').trim();
  const postalCode = String(formData.get('postalCode') ?? '').trim();

  /*
   * BigCommerce matches a state by abbreviation, but three US abbreviations —
   * AA, AE and AP, the armed-forces regions — are ambiguous enough that matching
   * on them can resolve to the wrong state and quote the wrong cost. For those,
   * send the full name instead. Ported from Catalyst, which hit the same thing.
   */
  const countries = await getCountries();
  const country = countries.find((candidate) => candidate.code === countryCode);
  const state = country?.states.find(
    (candidate) => candidate.abbreviation === stateValue || candidate.name === stateValue,
  );

  const useName = state ? AMBIGUOUS_US_ABBREVIATIONS.has(state.abbreviation) : false;

  try {
    const options = await estimateShipping(cartId, {
      countryCode,
      ...(state
        ? useName
          ? { stateOrProvince: state.name }
          : { stateOrProvinceCode: state.abbreviation }
        : {}),
      ...(city ? { city } : {}),
      ...(postalCode ? { postalCode } : {}),
    });

    // An empty list is "nothing ships there", which is a real answer and must
    // not read as a failure.
    return options.length > 0 ? { status: 'ok', options } : { status: 'none' };
  } catch {
    return { status: 'error', message: t('Cart.shippingEstimateFailed') };
  }
}

/** Drops the estimate consignment so it cannot follow the shopper to checkout. */
export async function cancelShippingEstimate(): Promise<void> {
  const cartId = await getCartId();

  if (!cartId) {
    return;
  }

  await clearShippingConsignments(cartId);
}

export interface SelectShippingState {
  status: 'idle' | 'ok' | 'error';
  /** Echoed back so the chosen radio survives the round trip. */
  selectedId?: string;
  message?: string;
}

/**
 * Applies the shopper's chosen shipping method.
 *
 * The estimator listed quotes and offered no way to pick one, so the consignment
 * kept whatever BigCommerce defaulted to — a shopper could read that Express
 * costs more and still be charged Ground.
 *
 * Both ids come from the estimate the shopper is looking at. They are opaque
 * BigCommerce ids validated by the mutation itself; a forged pair fails there
 * rather than silently applying someone else's consignment, because the checkout
 * id is taken from the session cart rather than the form.
 */
export async function selectShippingMethod(
  _previous: SelectShippingState | null,
  formData: FormData,
): Promise<SelectShippingState> {
  const t = await getTForAction();

  const cartId = await getCartId();

  if (!cartId) {
    return { status: 'error', message: t('Cart.shippingEstimateFailed') };
  }

  const consignmentId = String(formData.get('consignmentId') ?? '').trim();
  const optionId = String(formData.get('optionId') ?? '').trim();

  if (!consignmentId || !optionId) {
    return { status: 'error', message: t('Cart.shippingSelectRequired') };
  }

  try {
    await selectShippingOption(cartId, consignmentId, optionId);
  } catch (error) {
    console.error('[shipping] select', error);

    return { status: 'error', message: t('Cart.shippingEstimateFailed') };
  }

  /*
   * The summary reads the cart, and the applied shipping changes its total — so
   * without this the shopper picks Express and the total stays on Ground.
   */
  revalidateCart(cartId);

  return { status: 'ok', selectedId: optionId, message: t('Cart.shippingApplied') };
}
