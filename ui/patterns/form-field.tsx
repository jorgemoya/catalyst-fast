'use client';

import type { ReactNode } from 'react';

/**
 * One labelled input with its error.
 *
 * Extracted after the fourth near-identical copy appeared across the auth and
 * account forms. Every field in this project renders its error the same way and
 * wires `aria-describedby` the same way; doing that in one place is what stops
 * the fifth form from quietly omitting the aria wiring.
 */
export const inputClass =
  'h-10 w-full rounded-(--radius-control) border border-border bg-background px-2 text-sm';

export function FormField({
  name,
  label,
  errors,
  required,
  children,
}: {
  name: string;
  label: string;
  errors?: string[] | null;
  required?: boolean;
  children?: ReactNode;
}) {
  const errorId = errors?.length ? `${name}-error` : undefined;

  return (
    <div>
      <label className="mb-2 block text-sm font-medium" htmlFor={name}>
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      {children}
      {errorId && (
        <p className="mt-1 text-sm text-error" id={errorId} role="alert">
          {errors?.join(' ')}
        </p>
      )}
    </div>
  );
}

export function TextField({
  name,
  label,
  errors,
  required,
  type = 'text',
  autoComplete,
  defaultValue,
}: {
  name: string;
  label: string;
  errors?: string[] | null;
  required?: boolean;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
}) {
  return (
    <FormField errors={errors} label={label} name={name} required={required}>
      <input
        aria-describedby={errors?.length ? `${name}-error` : undefined}
        autoComplete={autoComplete}
        className={inputClass}
        defaultValue={defaultValue}
        id={name}
        name={name}
        required={required}
        type={type}
      />
    </FormField>
  );
}
