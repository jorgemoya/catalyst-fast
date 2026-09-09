'use client';

import { useTranslations } from 'next-intl';

import { getZodConstraint, parseWithZod } from '@conform-to/zod';
import { useForm } from '@conform-to/react';
import { useActionState, useMemo, useState } from 'react';

import { submitReview } from '~/app/[locale]/(storefront)/product/[id]/_actions/submit-review';
import { MAX_RATING, MIN_RATING, reviewSchema } from '~/domain/review';

import { RecaptchaField } from './recaptcha-field';

/**
 * Write-a-review form.
 *
 * Collapsed behind a button by default: the reviews section is far down the PDP
 * and the overwhelming majority of visitors are reading, not writing. Rendering
 * the whole form unconditionally would ship it to everyone for the small
 * fraction who use it.
 *
 * Client-side validation comes from the same Zod schema the action re-validates
 * with, via `getZodConstraint`, so the form works without JavaScript and
 * validates immediately with it.
 */

const RATINGS = Array.from(
  { length: MAX_RATING - MIN_RATING + 1 },
  (_, index) => MIN_RATING + index,
);

export function ReviewForm({ productId }: { productId: number }) {
  const t = useTranslations();

  /*
   * Built per render, not once at module scope.
   *
   * The schema carries **translated** validation messages, so a module-level
   * `reviewSchema(messages)` would freeze whichever locale happened to import
   * the module first and show English errors to a Spanish shopper. `useMemo`
   * keeps the per-render cost to a locale change rather than every keystroke.
   */
  const schema = useMemo(
    () =>
      reviewSchema({
        authorRequired: t('Product.reviewAuthorRequired'),
        emailRequired: t('Product.reviewEmailRequired'),
        emailInvalid: t('Product.reviewEmailInvalid'),
        titleRequired: t('Product.reviewTitleRequired'),
        titleTooLong: t('Product.reviewTitleTooLong'),
        textRequired: t('Product.reviewTextRequired'),
        textTooLong: t('Product.reviewTextTooLong'),
        ratingRequired: t('Product.reviewRatingRequired'),
      }),
    [t],
  );

  const [open, setOpen] = useState(false);
  const [result, action, pending] = useActionState(submitReview.bind(null, productId), null);

  const [form, fields] = useForm({
    lastResult: result,
    constraint: getZodConstraint(schema),
    shouldValidate: 'onBlur',
    onValidate: ({ formData }) => parseWithZod(formData, { schema }),
  });

  /*
   * The form is replaced by the confirmation rather than shown alongside it.
   * BigCommerce moderates reviews, so there is nothing to see afterwards and
   * leaving the filled-in form on screen invites a second submission — which
   * BigCommerce then rejects as a duplicate.
   */
  if (result?.status === 'success') {
    return (
      <p className="rounded-(--radius-control) border border-border p-4 text-sm" role="status">
        {t('Product.reviewThanks')}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        className="rounded-(--radius-control) border border-border px-4 py-2 text-sm hover:bg-accent"
        onClick={() => setOpen(true)}
        type="button"
      >
        {t('Product.writeReview')}
      </button>
    );
  }

  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-(--radius-control) border border-border p-4"
      id={form.id}
      noValidate
      onSubmit={form.onSubmit}
    >
      <h3 className="text-base font-semibold">{t('Product.reviewFormTitle')}</h3>

      {form.errors?.map((error) => (
        <p className="text-sm text-danger" key={error} role="alert">
          {error}
        </p>
      ))}

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">{t('Product.reviewRating')}</legend>
        <div className="flex gap-3">
          {RATINGS.map((value) => (
            <label className="flex items-center gap-1 text-sm" key={value}>
              <input
                defaultChecked={fields.rating.initialValue === String(value)}
                name={fields.rating.name}
                type="radio"
                value={value}
              />
              {value}
            </label>
          ))}
        </div>
        {fields.rating.errors?.map((error) => (
          <p className="text-sm text-danger" key={error}>
            {error}
          </p>
        ))}
      </fieldset>

      <Field field={fields.author} label={t('Product.reviewAuthor')} />
      <Field
        field={fields.email}
        help={t('Product.reviewEmailHelp')}
        label={t('Product.reviewEmail')}
        type="email"
      />
      <Field field={fields.title} label={t('Product.reviewTitle')} />

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor={fields.text.id}>
          {t('Product.reviewText')}
        </label>
        <textarea
          className="min-h-32 rounded-(--radius-control) border border-border p-2"
          defaultValue={fields.text.initialValue}
          id={fields.text.id}
          name={fields.text.name}
        />
        {fields.text.errors?.map((error) => (
          <p className="text-sm text-danger" key={error}>
            {error}
          </p>
        ))}
      </div>

      <RecaptchaField action="submit_review" name={fields.recaptchaToken.name} />

      <div className="flex items-center gap-2">
        <button
          className="rounded-(--radius-control) bg-foreground px-4 py-2 text-sm text-background disabled:opacity-60"
          disabled={pending}
          type="submit"
        >
          {pending ? t('Product.reviewSubmitting') : t('Product.reviewSubmit')}
        </button>
        <button
          className="rounded-(--radius-control) border border-border px-4 py-2 text-sm hover:bg-accent"
          onClick={() => setOpen(false)}
          type="button"
        >
          {t('Product.reviewCancel')}
        </button>
      </div>

      {/* Google requires this attribution wherever the v3 badge is hidden. */}
      <p className="text-xs text-muted">{t('Product.reviewRecaptchaNotice')}</p>
    </form>
  );
}

interface FieldProps {
  field: {
    id: string;
    name: string;
    initialValue?: string;
    errors?: string[];
  };
  label: string;
  help?: string;
  type?: string;
}

function Field({ field, label, help, type = 'text' }: FieldProps) {
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
      {help ? <p className="text-xs text-muted">{help}</p> : null}
      {field.errors?.map((error) => (
        <p className="text-sm text-danger" key={error}>
          {error}
        </p>
      ))}
    </div>
  );
}
