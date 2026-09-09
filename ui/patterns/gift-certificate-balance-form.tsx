'use client';

import { useLocale, useTranslations } from 'next-intl';

import { useActionState } from 'react';

import { checkGiftCertificateBalance } from '~/app/[locale]/(storefront)/gift-certificates/_actions/gift-certificate';
import { formatCurrencyIn } from '~/lib/i18n/messages';

/**
 * Gift certificate balance lookup.
 *
 * Deliberately spare on failure: an unknown code, a disabled one, and an expired
 * one all produce the same "not found". Anything more specific turns a public
 * unauthenticated form into an oracle for testing whether a code is real — and
 * gift certificate codes are bearer instruments worth money.
 */
export function GiftCertificateBalanceForm() {
  const t = useTranslations();
  const activeLocale = useLocale();

  const [result, action, pending] = useActionState(checkGiftCertificateBalance, null);

  return (
    <div className="max-w-md">
      <form action={action} className="flex flex-col gap-3">
        <label className="text-sm font-medium" htmlFor="gift-certificate-code">
          {t('GiftCertificates.code')}
        </label>
        <input
          autoComplete="off"
          className="rounded-(--radius-control) border border-border p-2"
          id="gift-certificate-code"
          name="code"
          // Codes are case-insensitive but visually confusable; turning off
          // autocorrect and capitalisation avoids a mobile keyboard mangling one.
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          type="text"
        />
        <button
          className="self-start rounded-(--radius-control) bg-foreground px-4 py-2 text-sm text-background disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? t('GiftCertificates.checking') : t('GiftCertificates.check')}
        </button>
      </form>

      {result?.status === 'empty' ? (
        <p className="mt-4 text-sm text-danger" role="alert">
          {t('GiftCertificates.codeRequired')}
        </p>
      ) : null}

      {result?.status === 'not-found' ? (
        <p className="mt-4 text-sm text-danger" role="alert">
          {t('GiftCertificates.notFound')}
        </p>
      ) : null}

      {result?.status === 'found' && result.certificate ? (
        <dl
          className="mt-6 grid grid-cols-2 gap-2 rounded-(--radius-control) border border-border p-4 text-sm"
          role="status"
        >
          <dt className="font-medium">{t('GiftCertificates.balanceRemaining')}</dt>
          <dd>
            {formatCurrencyIn(activeLocale, 
              result.certificate.balance.value,
              result.certificate.balance.currencyCode,
            )}
          </dd>

          <dt className="font-medium">{t('GiftCertificates.originalAmount')}</dt>
          <dd>
            {formatCurrencyIn(activeLocale, result.certificate.amount.value, result.certificate.amount.currencyCode)}
          </dd>

          <dt className="font-medium">{t('GiftCertificates.from')}</dt>
          <dd>{result.certificate.senderName}</dd>

          <dt className="font-medium">{t('GiftCertificates.purchased')}</dt>
          <dd>{new Date(result.certificate.purchasedAt).toLocaleDateString()}</dd>

          <dt className="font-medium">{t('GiftCertificates.expires')}</dt>
          <dd>
            {result.certificate.expiresAt
              ? new Date(result.certificate.expiresAt).toLocaleDateString()
              : t('GiftCertificates.neverExpires')}
          </dd>
        </dl>
      ) : null}
    </div>
  );
}
