import { z } from 'zod';

/**
 * Merchant-configured custom form fields.
 *
 * Three jobs, all pure so they can be unit-tested without a store: normalise
 * BigCommerce's nine-member `FormField` union into one model, build a zod schema
 * from it, and map a submission back into `CustomerFormFieldsInput`.
 *
 * **The field name carries the id.** A custom field has no stable key, only an
 * `entityId`, so inputs are named `custom_<entityId>` and the id is read back out
 * on submission. Anything else would need a second lookup at submit time to
 * discover which field a value belonged to.
 */

export type CustomFieldKind =
  | 'text'
  | 'multiline'
  | 'number'
  | 'date'
  | 'picklist'
  | 'radio'
  | 'checkboxes';

export interface CustomFieldOption {
  id: number;
  label: string;
}

export interface CustomFormField {
  id: number;
  kind: CustomFieldKind;
  label: string;
  required: boolean;
  sortOrder: number;
  /** Picklist, radio and checkbox fields only. */
  options?: CustomFieldOption[];
  /** Picklist only — the "choose one" placeholder. */
  choosePrefix?: string;
  maxLength?: number;
  rows?: number;
  min?: number;
  max?: number;
  minDate?: string;
  maxDate?: string;
}

export interface PasswordRules {
  minLength: number;
  requireLowerCase: boolean;
  requireUpperCase: boolean;
  requireNumbers: boolean;
}

export const CUSTOM_FIELD_PREFIX = 'custom_';

export const fieldName = (id: number): string => `${CUSTOM_FIELD_PREFIX}${id}`;

/*
 * `PasswordFormField` and `PicklistOrTextFormField` are deliberately absent.
 * Password custom fields are a built-in concern the registration form already
 * handles, and `PicklistOrTextFormField` has no matching member on
 * `CustomerFormFieldsInput` — there is no way to submit one, so rendering it
 * would collect a value that could never be sent.
 */
const KIND_BY_TYPENAME: Record<string, CustomFieldKind> = {
  TextFormField: 'text',
  MultilineTextFormField: 'multiline',
  NumberFormField: 'number',
  DateFormField: 'date',
  PicklistFormField: 'picklist',
  RadioButtonsFormField: 'radio',
  CheckboxesFormField: 'checkboxes',
};

interface RawFormField {
  __typename: string;
  entityId: number;
  label: string;
  sortOrder: number;
  isBuiltIn: boolean;
  isRequired: boolean;
  maxLength?: number | null;
  rows?: number | null;
  minNumber?: number | null;
  maxNumber?: number | null;
  minDate?: string | null;
  maxDate?: string | null;
  choosePrefix?: string | null;
  options?: ReadonlyArray<{ entityId: number; label: string }>;
}

/**
 * Keeps only the custom fields, in the merchant's own order.
 *
 * Built-ins are dropped because the forms render those by hand — see the note in
 * `data/form-fields.ts`. Unsupported union members are dropped rather than
 * guessed at: a field we cannot submit is worse than a field we do not show.
 */
export function toCustomFields(fields: readonly RawFormField[]): CustomFormField[] {
  return fields
    .filter((field) => !field.isBuiltIn && KIND_BY_TYPENAME[field.__typename] !== undefined)
    .map((field) => ({
      id: field.entityId,
      kind: KIND_BY_TYPENAME[field.__typename]!,
      label: field.label,
      required: field.isRequired,
      sortOrder: field.sortOrder,
      ...(field.options && { options: field.options.map((o) => ({ id: o.entityId, label: o.label })) }),
      ...(field.choosePrefix != null && { choosePrefix: field.choosePrefix }),
      ...(field.maxLength != null && { maxLength: field.maxLength }),
      ...(field.rows != null && { rows: field.rows }),
      ...(field.minNumber != null && { min: field.minNumber }),
      ...(field.maxNumber != null && { max: field.maxNumber }),
      ...(field.minDate != null && { minDate: field.minDate }),
      ...(field.maxDate != null && { maxDate: field.maxDate }),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export interface CustomFieldMessages {
  required: string;
  tooLong: (max: number) => string;
  invalidNumber: string;
}

/**
 * Zod shape for a set of custom fields, merged into a form's own schema.
 *
 * Everything is validated as a string because that is what a form submits;
 * coercion to number or date happens in `toFormFieldsInput`, where the target
 * type is known. Validating and coercing in one step here would mean the schema
 * could no longer describe the raw submission, which is what conform needs.
 */
export function customFieldsSchema(
  fields: readonly CustomFormField[],
  messages: CustomFieldMessages,
): z.ZodRawShape {
  const shape: z.ZodRawShape = {};

  for (const field of fields) {
    const key = fieldName(field.id);

    if (field.kind === 'checkboxes') {
      // A checkbox group submits zero or more values under one name.
      shape[key] = field.required
        ? z.array(z.string()).min(1, messages.required)
        : z.array(z.string()).optional();

      continue;
    }

    let rule = z.string().trim();

    if (field.maxLength !== undefined) {
      rule = rule.max(field.maxLength, messages.tooLong(field.maxLength));
    }

    if (field.kind === 'number') {
      shape[key] = field.required
        ? rule.min(1, messages.required).refine((v) => !Number.isNaN(Number(v)), messages.invalidNumber)
        : rule.optional().refine((v) => !v || !Number.isNaN(Number(v)), messages.invalidNumber);

      continue;
    }

    shape[key] = field.required ? rule.min(1, messages.required) : rule.optional();
  }

  return shape;
}

export interface CustomerFormFieldsInput {
  texts?: Array<{ fieldEntityId: number; text: string }>;
  multilineTexts?: Array<{ fieldEntityId: number; multilineText: string }>;
  numbers?: Array<{ fieldEntityId: number; number: number }>;
  dates?: Array<{ fieldEntityId: number; date: string }>;
  multipleChoices?: Array<{ fieldEntityId: number; fieldValueEntityId: number }>;
  checkboxes?: Array<{ fieldEntityId: number; fieldValueEntityIds: number[] }>;
}

/**
 * Maps a submission into `CustomerFormFieldsInput`.
 *
 * Reads from `FormData` rather than a parsed object so a checkbox group's
 * repeated values survive — `Object.fromEntries` keeps only the last one, which
 * would silently drop every selection but one.
 *
 * Empty optional fields are omitted entirely. Sending `text: ""` for a field the
 * shopper left blank is not the same as not answering, and BigCommerce stores
 * the difference.
 */
export function toFormFieldsInput(
  fields: readonly CustomFormField[],
  formData: FormData,
): CustomerFormFieldsInput | undefined {
  const input: CustomerFormFieldsInput = {};

  for (const field of fields) {
    const key = fieldName(field.id);

    if (field.kind === 'checkboxes') {
      const ids = formData
        .getAll(key)
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value));

      if (ids.length > 0) {
        (input.checkboxes ??= []).push({ fieldEntityId: field.id, fieldValueEntityIds: ids });
      }

      continue;
    }

    const raw = formData.get(key);
    const value = typeof raw === 'string' ? raw.trim() : '';

    if (!value) {
      continue;
    }

    switch (field.kind) {
      case 'text':
        (input.texts ??= []).push({ fieldEntityId: field.id, text: value });
        break;

      case 'multiline':
        (input.multilineTexts ??= []).push({ fieldEntityId: field.id, multilineText: value });
        break;

      case 'number': {
        const number = Number(value);

        if (!Number.isNaN(number)) {
          (input.numbers ??= []).push({ fieldEntityId: field.id, number });
        }

        break;
      }

      case 'date':
        // BigCommerce wants a DateTime; a date input gives `YYYY-MM-DD`. Anchor
        // at UTC midnight, the same rule `domain/cart-line.ts` uses, so the
        // stored day matches the day the shopper picked.
        (input.dates ??= []).push({ fieldEntityId: field.id, date: `${value}T00:00:00Z` });
        break;

      case 'picklist':
      case 'radio': {
        const id = Number(value);

        if (Number.isInteger(id)) {
          (input.multipleChoices ??= []).push({ fieldEntityId: field.id, fieldValueEntityId: id });
        }

        break;
      }
    }
  }

  return Object.keys(input).length > 0 ? input : undefined;
}

/**
 * Password rules as a zod schema, from the store's own settings.
 *
 * Each rule is a separate `refine` so the shopper sees exactly which one they
 * missed rather than one combined message — the difference between "fix this"
 * and "guess again".
 */
export function passwordSchema(
  rules: PasswordRules,
  messages: {
    tooShort: (min: number) => string;
    needsLowerCase: string;
    needsUpperCase: string;
    needsNumber: string;
  },
): z.ZodType<string> {
  let rule = z.string().min(rules.minLength, messages.tooShort(rules.minLength));

  if (rules.requireLowerCase) {
    rule = rule.refine((v) => /[a-z]/u.test(v), messages.needsLowerCase) as never;
  }

  if (rules.requireUpperCase) {
    rule = rule.refine((v) => /[A-Z]/u.test(v), messages.needsUpperCase) as never;
  }

  if (rules.requireNumbers) {
    rule = rule.refine((v) => /\d/u.test(v), messages.needsNumber) as never;
  }

  return rule;
}
