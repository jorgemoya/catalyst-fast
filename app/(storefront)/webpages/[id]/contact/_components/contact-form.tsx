'use client';

import { useActionState } from 'react';

import type { ContactField } from '~/domain/contact';
import { t } from '~/lib/i18n/messages';

import { submitContactForm } from '../_actions/submit';

/**
 * The contact form.
 *
 * Fields are described by `domain/contact.ts` and rendered from that description,
 * so the inputs drawn here and the schema validated on the server come from one
 * source. Labels are looked up by field id — the domain names fields, the UI
 * names them in a language.
 */

const inputClass =
  'h-10 w-full rounded-(--radius-control) border border-border bg-background px-2 text-sm';

export function ContactForm({ nodeId, fields }: { nodeId: string; fields: ContactField[] }) {
  const [result, formAction, isPending] = useActionState(
    submitContactForm.bind(null, nodeId),
    null,
  );

  const errors = result?.error ?? {};
  const formErrors = errors[''] ?? [];
  const sent = result?.status === 'success';

  return (
    <form action={formAction} className="mt-8 flex max-w-lg flex-col gap-4">
      {fields.map((field) => (
        <Field
          errors={errors[field.id]}
          key={field.id}
          label={t(`Contact.fields.${field.id}`)}
          name={field.id}
        >
          <input
            autoComplete={field.autoComplete}
            className={inputClass}
            id={field.id}
            name={field.id}
            type={field.type}
          />
        </Field>
      ))}

      {/* Always present, always required — BigCommerce treats both as implicit
          and rejects the mutation without them. */}
      <Field errors={errors.email} label={t('Contact.fields.email')} name="email" required>
        <input
          autoComplete="email"
          className={inputClass}
          id="email"
          name="email"
          required
          type="email"
        />
      </Field>

      <Field errors={errors.comments} label={t('Contact.fields.comments')} name="comments" required>
        <textarea
          className="w-full rounded-(--radius-control) border border-border bg-background px-2 py-1.5 text-sm"
          id="comments"
          name="comments"
          required
          rows={5}
        />
      </Field>

      <button
        className="h-11 self-start rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {isPending ? t('Contact.sending') : t('Contact.submit')}
      </button>

      {formErrors.length > 0 && (
        <p className="text-sm text-error" role="alert">
          {formErrors.join(' ')}
        </p>
      )}

      {sent && (
        <p className="text-sm text-in-stock" data-testid="contact-success" role="status">
          {t('Contact.success')}
        </p>
      )}
    </form>
  );
}

function Field({
  name,
  label,
  required,
  errors,
  children,
}: {
  name: string;
  label: string;
  required?: boolean;
  errors?: string[] | null;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-2 block text-sm font-medium" htmlFor={name}>
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      {children}
      {errors && errors.length > 0 && (
        <p className="mt-1 text-sm text-error" role="alert">
          {errors.join(' ')}
        </p>
      )}
    </div>
  );
}
