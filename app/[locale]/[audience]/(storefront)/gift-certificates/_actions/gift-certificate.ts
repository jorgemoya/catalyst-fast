'use server';

import { getTForAction } from '~/lib/i18n/server';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';

import {
  type GiftCertificateBalance,
  getGiftCertificateBalance,
  getGiftCertificateSettings,
} from '~/data/gift-certificates';
import { giftCertificateSchema } from '~/domain/gift-certificate';
import { toSubmissionErrorMessage } from '~/lib/cart/error-message';
import { addGiftCertificateToCart } from '~/lib/cart/mutations';
import { revalidateCart } from '~/lib/cart/revalidate';

/**
 * Gift certificate purchase and balance lookup.
 *
 * The purchase bounds are re-read from BigCommerce here rather than trusted from
 * the form. The client renders a `<select>` of allowed denominations or a
 * min/max number input, but neither is a constraint — and an unchecked amount is
 * a shopper choosing what to pay.
 */

const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

export async function purchaseGiftCertificate(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  const settings = await getGiftCertificateSettings();

  if (!settings.enabled) {
    return formError(t('GiftCertificates.disabled'));
  }

  const bounds =
    settings.mode === 'fixed'
      ? {
          min: Math.min(...settings.amounts),
          max: Math.max(...settings.amounts),
          allowedAmounts: settings.amounts,
        }
      : { min: settings.min, max: settings.max };

  const submission = parseWithZod(formData, {
    schema: giftCertificateSchema(
      {
        senderNameRequired: t('GiftCertificates.senderNameRequired'),
        senderEmailRequired: t('GiftCertificates.senderEmailRequired'),
        senderEmailInvalid: t('GiftCertificates.emailInvalid'),
        recipientNameRequired: t('GiftCertificates.recipientNameRequired'),
        recipientEmailRequired: t('GiftCertificates.recipientEmailRequired'),
        recipientEmailInvalid: t('GiftCertificates.emailInvalid'),
        amountRequired: t('GiftCertificates.amountRequired'),
        amountRange: t('GiftCertificates.amountRange'),
        messageTooLong: t('GiftCertificates.messageTooLong'),
        termsRequired: t('GiftCertificates.termsRequired'),
      },
      bounds,
    ),
  });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  const value = submission.value;

  try {
    const cartId = await addGiftCertificateToCart({
      // BigCommerce shows this in the control panel; the recipient's name is the
      // only thing that makes one certificate distinguishable from another.
      name: `Gift certificate for ${value.recipientName}`,
      theme: value.theme,
      amount: value.amount,
      quantity: 1,
      sender: { name: value.senderName, email: value.senderEmail },
      recipient: { name: value.recipientName, email: value.recipientEmail },
      message: value.message ?? '',
    });

    revalidateCart(cartId);
  } catch (error) {
    /*
     * `add-failed`, not the existing `gift-certificate-failed` code: that one
     * means "this code is not valid for this cart", which is *redemption*. This
     * is a purchase failing to reach the cart, and telling a shopper their code
     * is invalid when they are buying a certificate would be nonsense.
     */
    return formError(toSubmissionErrorMessage(t, error, 'add-failed'));
  }

  return { status: 'success' };
}

export interface BalanceResult {
  status: 'found' | 'not-found' | 'empty';
  certificate?: GiftCertificateBalance;
}

/**
 * Balance lookup.
 *
 * Returns the same `not-found` for a code that does not exist and one that is
 * disabled or expired. Distinguishing them would turn this public, unauthenticated
 * form into an oracle for enumerating valid gift certificate codes — which are
 * bearer instruments worth real money.
 */
export async function checkGiftCertificateBalance(
  _previous: BalanceResult | null,
  formData: FormData,
): Promise<BalanceResult> {
  const code = String(formData.get('code') ?? '').trim();

  if (!code) {
    return { status: 'empty' };
  }

  try {
    const certificate = await getGiftCertificateBalance(code);

    if (!certificate || certificate.status !== 'ACTIVE') {
      return { status: 'not-found' };
    }

    return { status: 'found', certificate };
  } catch {
    return { status: 'not-found' };
  }
}
