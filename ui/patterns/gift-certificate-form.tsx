'use client';

import { useLocale, useTranslations } from 'next-intl';

import { useForm } from '@conform-to/react';
import { getZodConstraint, parseWithZod } from '@conform-to/zod';
import { useActionState, useMemo } from 'react';

import { purchaseGiftCertificate } from '~/app/[locale]/(storefront)/gift-certificates/_actions/gift-certificate';
import {
  type ExpiryUnit,
  GIFT_CERTIFICATE_THEMES,
  computeExpiry,
  giftCertificateSchema,
} from '~/domain/gift-certificate';
import { formatCurrencyIn } from '~/lib/i18n/messages';

/**
 * Gift certificate purchase form.
 *
 * Renders as a `<select>` of denominations or a bounded number input depending
 * on the store's mode — BigCommerce models these as two different settings
 * types, and collapsing them into one "amount" field would let a shopper on a
 * fixed-denomination store type an arbitrary value that the server then rejects.
 *
 * The same schema validates here and in the action, with the same bounds, so a
 * value that passes client-side cannot fail server-side for a different reason.
 */
interface Props {
  currencyCode: string;
  /** Fixed-denomination store: the allowed values. */
  amounts?: number[];
  /** Custom-amount store: the inclusive range. */
  min?: number;
  max?: number;
  /**
   * The store's expiry rule, or null when certificates never expire. The date
   * itself is computed here, in the browser — see the note in the purchase page
   * on why the server must not.
   */
  expiry: { value: number; unit: ExpiryUnit } | null;
}

export function GiftCertificateForm({ currencyCode, amounts, min, max, expiry }: Props) {
  const t = useTranslations();
  const activeLocale = useLocale();

  // Relative to the shopper's clock, which is what "expires in 12 months" means
  // to them. Recomputed on render, which is cheap and always current.
  const expiresAt = expiry ? computeExpiry(new Date(), expiry.value, expiry.unit) : null;
  const [result, action, pending] = useActionState(purchaseGiftCertificate, null);

  /*
   * Built per render, not at module scope: the schema carries translated
   * validation messages, and a module-level constant would freeze whichever
   * locale imported the module first — showing English errors to a Spanish
   * shopper.
   */
  const schema = useMemo(
    () =>
      giftCertificateSchema(
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
        {
          min: amounts ? Math.min(...amounts) : (min ?? 0),
          max: amounts ? Math.max(...amounts) : (max ?? 0),
          allowedAmounts: amounts,
        },
      ),
    [t, amounts, min, max],
  );

  const [form, fields] = useForm({
    lastResult: result,
    constraint: getZodConstraint(schema),
    shouldValidate: 'onBlur',
    onValidate: ({ formData }) => parseWithZod(formData, { schema }),
  });

  if (result?.status === 'success') {
    return (
      <p className="max-w-xl rounded-(--radius-control) border border-border p-4" role="status">
        {t('GiftCertificates.added')}
      </p>
    );
  }

  return (
    <form
      action={action}
      className="flex max-w-xl flex-col gap-4"
      id={form.id}
      noValidate
      onSubmit={form.onSubmit}
    >
      {form.errors?.map((error) => (
        <p className="text-sm text-danger" key={error} role="alert">
          {error}
        </p>
      ))}

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor={fields.amount.id}>
          {t('GiftCertificates.amount')}
        </label>

        {amounts ? (
          <select
            className="rounded-(--radius-control) border border-border p-2"
            defaultValue={fields.amount.initialValue}
            id={fields.amount.id}
            name={fields.amount.name}
          >
            <option value="">{t('GiftCertificates.chooseAmount')}</option>
            {amounts.map((amount) => (
              <option key={amount} value={amount}>
                {formatCurrencyIn(activeLocale, amount, currencyCode)}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="rounded-(--radius-control) border border-border p-2"
            defaultValue={fields.amount.initialValue}
            id={fields.amount.id}
            max={max}
            min={min}
            name={fields.amount.name}
            // `any` rather than 1: a store may sell a £12.50 certificate, and a
            // whole-number step would make that unenterable.
            step="any"
            type="number"
          />
        )}

        {fields.amount.errors?.map((error) => (
          <p className="text-sm text-danger" key={error}>
            {error}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor={fields.theme.id}>
          {t('GiftCertificates.theme')}
        </label>
        <select
          className="rounded-(--radius-control) border border-border p-2"
          defaultValue={fields.theme.initialValue ?? 'GENERAL'}
          id={fields.theme.id}
          name={fields.theme.name}
        >
          {GIFT_CERTIFICATE_THEMES.map((theme) => (
            <option key={theme} value={theme}>
              {theme.charAt(0) + theme.slice(1).toLowerCase()}
            </option>
          ))}
        </select>
      </div>

      <TextField field={fields.senderName} label={t('GiftCertificates.senderName')} />
      <TextField
        field={fields.senderEmail}
        label={t('GiftCertificates.senderEmail')}
        type="email"
      />
      <TextField field={fields.recipientName} label={t('GiftCertificates.recipientName')} />
      <TextField
        field={fields.recipientEmail}
        label={t('GiftCertificates.recipientEmail')}
        type="email"
      />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor={fields.message.id}>
          {t('GiftCertificates.message')}
        </label>
        <textarea
          className="min-h-24 rounded-(--radius-control) border border-border p-2"
          defaultValue={fields.message.initialValue}
          id={fields.message.id}
          maxLength={200}
          name={fields.message.name}
        />
        <p className="text-xs text-muted">{t('GiftCertificates.messageHelp')}</p>
        {fields.message.errors?.map((error) => (
          <p className="text-sm text-danger" key={error}>
            {error}
          </p>
        ))}
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex items-start gap-2 text-sm">
          <input name={fields.terms.name} type="checkbox" />
          <span>
            {/* Names the actual expiry date when the store sets one — "expires
                in 12 months" is not something a shopper can check later. */}
            {expiresAt
              ? t('GiftCertificates.termsWithExpiry', { date: expiresAt.toLocaleDateString() })
              : t('GiftCertificates.terms')}
          </span>
        </label>
        {fields.terms.errors?.map((error) => (
          <p className="text-sm text-danger" key={error}>
            {error}
          </p>
        ))}
      </div>

      <button
        className="self-start rounded-(--radius-control) bg-foreground px-4 py-2 text-sm text-background disabled:opacity-60"
        disabled={pending}
        type="submit"
      >
        {pending ? t('GiftCertificates.adding') : t('GiftCertificates.addToCart')}
      </button>
    </form>
  );
}

function TextField({
  field,
  label,
  type = 'text',
}: {
  field: { id: string; name: string; initialValue?: string; errors?: string[] };
  label: string;
  type?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium" htmlFor={field.id}>
        {label}
      </label>
      <input
        className="rounded-(--radius-control) border border-border p-2"
        defaultValue={field.initialValue}
        id={field.id}
        name={field.name}
        type={type}
      />
      {field.errors?.map((error) => (
        <p className="text-sm text-danger" key={error}>
          {error}
        </p>
      ))}
    </div>
  );
}
