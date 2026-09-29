'use client';

import { useTranslations } from 'next-intl';

import type { SubmissionResult } from '@conform-to/react';
import { useActionState } from 'react';


/**
 * Apply-a-code form, shared by coupons and gift certificates.
 *
 * They differ only in labels and which action they call, so they share one
 * component — the alternative was two near-identical files that drift the moment
 * one of them grows a state the other doesn't.
 *
 * A rejected code is a field error, not an exception: the input keeps focus and
 * the shopper can correct it in place.
 */

type CodeAction = (
  previous: SubmissionResult | null,
  formData: FormData,
) => Promise<SubmissionResult>;

interface Props {
  action: CodeAction;
  /** Stable identifier for the input id and test hooks — not user-visible. */
  name: string;
  label: string;
  placeholder: string;
  submitLabel: string;
}

export function CodeForm({ action, name, label, placeholder, submitLabel }: Props) {
  const t = useTranslations();

  const [result, formAction, isPending] = useActionState(action, null);
  // A rejected code can come back either as a field error (empty input) or a
  // form error (BigCommerce refused it), and both belong on the same input.
  const errors = [...(result?.error?.[''] ?? []), ...(result?.error?.code ?? [])];
  const id = `code-${name}`;

  return (
    <form action={formAction}>
      <label className="mb-2 block text-sm font-medium" htmlFor={id}>
        {label}
      </label>

      <div className="flex gap-2">
        <input
          aria-describedby={errors.length > 0 ? `${id}-error` : undefined}
          className="h-10 flex-1 rounded-(--radius-control) border border-border bg-background px-2 text-sm"
          disabled={isPending}
          id={id}
          name="code"
          placeholder={placeholder}
          type="text"
        />
        <button
          className="h-10 rounded-(--radius-control) border border-border px-4 text-sm font-medium transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          disabled={isPending}
          type="submit"
        >
          {isPending ? t('Cart.applying') : submitLabel}
        </button>
      </div>

      {errors.length > 0 && (
        <p
          className="mt-1 text-sm text-error"
          data-testid={`${name}-error`}
          id={`${id}-error`}
          role="alert"
        >
          {errors.join(' ')}
        </p>
      )}
    </form>
  );
}

/**
 * Removing an applied code. A plain form rather than a `<button onClick>` so it
 * needs no client state of its own — the applied codes are server-rendered, and
 * this posts the one being removed.
 */
export function RemoveCodeForm({
  action,
  code,
  label,
}: {
  action: CodeAction;
  code: string;
  label: string;
}) {
  const t = useTranslations();

  const [, formAction, isPending] = useActionState(action, null);

  return (
    <form action={formAction} className="inline">
      <input name="code" type="hidden" value={code} />
      <button
        aria-label={label}
        className="text-xs text-muted underline underline-offset-4 hover:text-foreground disabled:opacity-50"
        disabled={isPending}
        type="submit"
      >
        {t('Cart.remove')}
      </button>
    </form>
  );
}
