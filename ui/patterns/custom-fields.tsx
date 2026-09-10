'use client';

import type { CustomFormField } from '~/domain/form-fields';
import { fieldName } from '~/domain/form-fields';

/**
 * Renders a store's merchant-configured custom form fields.
 *
 * One component for registration, addresses and account settings, because the
 * field model is identical across all three — only the source list differs. The
 * contact form already proved this shape; it just was not applied to the
 * customer and address forms, so three fields configured on this store were
 * being dropped.
 *
 * Uncontrolled on purpose: these are ordinary inputs whose values are read off
 * `FormData` at submit time. Controlling them would mean a state object keyed by
 * entity id for no behavioural gain, and would break progressive enhancement.
 *
 * `errors` is keyed by the same `custom_<id>` name the inputs use, so a caller
 * can pass conform's error object straight through.
 */
export function CustomFields({
  fields,
  errors,
  disabled,
}: {
  fields: CustomFormField[];
  /*
   * `string[] | null | undefined` because that is what conform's `error` object
   * actually is — `null` for a field it has evaluated and found clean, absent
   * for one it has not seen. Narrowing to `undefined` would force every caller
   * to launder it.
   */
  errors?: Record<string, string[] | null | undefined>;
  disabled?: boolean;
}) {
  if (fields.length === 0) {
    return null;
  }

  return (
    <>
      {fields.map((field) => (
        <CustomField
          disabled={disabled}
          errors={errors?.[fieldName(field.id)]}
          field={field}
          key={field.id}
        />
      ))}
    </>
  );
}

const INPUT_CLASS =
  'rounded-(--radius-control) border border-border bg-background p-2 text-sm disabled:opacity-60';

function CustomField({
  field,
  errors,
  disabled,
}: {
  field: CustomFormField;
  errors?: string[] | null;
  disabled?: boolean;
}) {
  const name = fieldName(field.id);

  return (
    <div className="flex flex-col gap-1">
      {/*
        A checkbox *group* labels itself with a legend rather than a `<label>`,
        because a label pointing at one of several inputs is wrong — and pointing
        at none is worse for a screen reader.
      */}
      {field.kind === 'checkboxes' ? (
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium">
            {field.label}
            {field.required ? ' *' : ''}
          </legend>

          {field.options?.map((option) => (
            <label className="flex items-center gap-2 text-sm" key={option.id}>
              <input
                className="size-4"
                disabled={disabled}
                name={name}
                type="checkbox"
                value={String(option.id)}
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      ) : (
        <>
          <label className="text-sm font-medium" htmlFor={name}>
            {field.label}
            {field.required ? ' *' : ''}
          </label>

          <FieldControl disabled={disabled} field={field} name={name} />
        </>
      )}

      {errors?.map((error) => (
        <p className="text-sm text-error" key={error}>
          {error}
        </p>
      ))}
    </div>
  );
}

function FieldControl({
  field,
  name,
  disabled,
}: {
  field: CustomFormField;
  name: string;
  disabled?: boolean;
}) {
  switch (field.kind) {
    case 'multiline':
      return (
        <textarea
          className={INPUT_CLASS}
          disabled={disabled}
          id={name}
          name={name}
          required={field.required}
          rows={field.rows ?? 4}
          {...(field.maxLength !== undefined && { maxLength: field.maxLength })}
        />
      );

    case 'picklist':
      return (
        <select
          className={INPUT_CLASS}
          defaultValue=""
          disabled={disabled}
          id={name}
          name={name}
          required={field.required}
        >
          {/* The merchant's own placeholder wording, not ours. */}
          <option value="">{field.choosePrefix ?? ''}</option>
          {field.options?.map((option) => (
            <option key={option.id} value={String(option.id)}>
              {option.label}
            </option>
          ))}
        </select>
      );

    case 'radio':
      return (
        <div className="flex flex-col gap-1" id={name}>
          {field.options?.map((option) => (
            <label className="flex items-center gap-2 text-sm" key={option.id}>
              <input
                className="size-4"
                disabled={disabled}
                name={name}
                required={field.required}
                type="radio"
                value={String(option.id)}
              />
              {option.label}
            </label>
          ))}
        </div>
      );

    case 'number':
      return (
        <input
          className={INPUT_CLASS}
          disabled={disabled}
          id={name}
          name={name}
          required={field.required}
          type="number"
          {...(field.min !== undefined && { min: field.min })}
          {...(field.max !== undefined && { max: field.max })}
        />
      );

    case 'date':
      return (
        <input
          className={INPUT_CLASS}
          disabled={disabled}
          id={name}
          name={name}
          required={field.required}
          type="date"
          {...(field.minDate !== undefined && { min: field.minDate.slice(0, 10) })}
          {...(field.maxDate !== undefined && { max: field.maxDate.slice(0, 10) })}
        />
      );

    default:
      return (
        <input
          className={INPUT_CLASS}
          disabled={disabled}
          id={name}
          name={name}
          required={field.required}
          type="text"
          {...(field.maxLength !== undefined && { maxLength: field.maxLength })}
        />
      );
  }
}
