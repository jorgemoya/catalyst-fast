import { z } from 'zod';

import type { ProductOptionField } from './product-options';

/**
 * Turning a PDP form submission into a BigCommerce cart line.
 *
 * Two things happen here, and both are derived from the product's *own* option
 * definitions rather than from anything the browser sent:
 *
 *  1. **A validation schema.** BigCommerce enforces option constraints server-side
 *     and rejects the whole mutation with an opaque error, so the same rules —
 *     required, min/max, length bounds — are checked here first to produce
 *     per-field messages the shopper can act on.
 *  2. **The `selectedOptions` input.** BigCommerce wants the six option kinds
 *     sorted into six separate lists, which is the shape this produces.
 *
 * Rebuilding the schema server-side from `getProduct(id).options` (a cached read,
 * so it costs nothing) rather than trusting a client-supplied description is the
 * security-relevant part: a submitted value is only ever interpreted as the kind
 * of option the catalog says it is. It is also what stops a number field's value
 * being sent as an option-value id — the bug found in the Phase 3 audit, here
 * prevented structurally instead of by a filter.
 */

/**
 * Structural mirror of BigCommerce's `CartSelectedOptionsInput`.
 *
 * Declared here rather than imported from the GraphQL layer so `domain/` stays
 * free of transport types and unit-testable without a schema.
 */
export interface CartSelectedOptionsInput {
  multipleChoices?: Array<{ optionEntityId: number; optionValueEntityId: number }>;
  checkboxes?: Array<{ optionEntityId: number; optionValueEntityId: number }>;
  numberFields?: Array<{ optionEntityId: number; number: number }>;
  textFields?: Array<{ optionEntityId: number; text: string }>;
  multiLineTextFields?: Array<{ optionEntityId: number; text: string }>;
  dateFields?: Array<{ optionEntityId: number; date: string }>;
}

/**
 * Copy is injected rather than written here, for the same reason
 * `domain/availability.ts` returns a `kind` instead of a label: this layer states
 * rules, the UI states them in a language. Functions rather than strings because
 * every one of these interpolates the bound it's reporting.
 */
export interface ValidationMessages {
  required: string;
  minLength: (min: number) => string;
  maxLength: (max: number) => string;
  min: (min: number) => string;
  max: (max: number) => string;
  invalidDate: string;
}

export interface QuantityLimits {
  min: number;
  max: number | null;
}

/** An empty text input arrives as `''`, which is an absent value, not a short one. */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

function textSchema(
  field: Extract<ProductOptionField, { type: 'text' | 'textarea' }>,
  messages: ValidationMessages,
): z.ZodTypeAny {
  let schema = z.string();

  if (field.minLength !== undefined) {
    schema = schema.min(field.minLength, messages.minLength(field.minLength));
  }

  if (field.maxLength !== undefined) {
    schema = schema.max(field.maxLength, messages.maxLength(field.maxLength));
  }

  return schema;
}

function numberSchema(
  field: Extract<ProductOptionField, { type: 'number' }>,
  messages: ValidationMessages,
): z.ZodTypeAny {
  let schema = field.integerOnly ? z.coerce.number().int() : z.coerce.number();

  if (field.min !== undefined) {
    schema = schema.min(field.min, messages.min(field.min));
  }

  if (field.max !== undefined) {
    schema = schema.max(field.max, messages.max(field.max));
  }

  return schema;
}

function fieldSchema(field: ProductOptionField, messages: ValidationMessages): z.ZodTypeAny {
  switch (field.type) {
    case 'swatch':
    case 'buttons':
    case 'radio':
    case 'select':
    case 'cards':
    // A checkbox is always submitted — "unchecked" is a distinct option-value id
    // rather than an absent value — so it needs no special case.
    case 'checkbox':
      return z.string();

    case 'number':
      return numberSchema(field, messages);

    case 'text':
    case 'textarea':
      return textSchema(field, messages);

    case 'date':
      return z.string().refine((value) => !Number.isNaN(Date.parse(value)), messages.invalidDate);

    default:
      return z.string();
  }
}

/**
 * The schema for one product's purchase form.
 *
 * Field names are `option.<optionEntityId>`, which conform parses into a nested
 * `option` object — so the shape of the form and the shape of the schema stay
 * the same however many options a product has.
 */
export function purchaseSchema(
  fields: ProductOptionField[],
  quantity: QuantityLimits,
  messages: ValidationMessages,
) {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    // Always optional at the schema level, with "required" enforced by a refine
    // afterwards. The obvious alternative — a non-optional schema, letting zod
    // report the missing value — silently ignores the injected message and emits
    // zod's own untranslatable "Required" instead, which is the whole reason
    // copy is passed in here.
    const schema = z.preprocess(blankToUndefined, fieldSchema(field, messages).optional());

    shape[field.id] = field.required
      ? schema.refine((value) => value !== undefined, { message: messages.required })
      : schema;
  }

  let quantitySchema = z.coerce.number().int().min(quantity.min, messages.min(quantity.min));

  if (quantity.max !== null) {
    quantitySchema = quantitySchema.max(quantity.max, messages.max(quantity.max));
  }

  return z.object({
    quantity: quantitySchema,
    // Absent entirely for a product with no options.
    option: z.object(shape).default({}),
  });
}

export type PurchaseValues = {
  quantity: number;
  option: Record<string, string | number | undefined>;
};

/**
 * `<input type="date">` submits `YYYY-MM-DD`; BigCommerce wants a `DateTime`.
 * Anchoring at UTC midnight keeps the date the shopper picked from drifting a day
 * when the server's timezone is behind them.
 */
const toDateTime = (value: string): string => new Date(`${value}T00:00:00.000Z`).toISOString();

/**
 * Sorts the shopper's answers into BigCommerce's six per-kind lists.
 *
 * Driven by `fields`, not by the submitted keys: an option the catalog doesn't
 * define is ignored rather than guessed at. Empty lists are omitted entirely,
 * since sending `[]` asserts "no choices for this kind" rather than "not
 * applicable".
 */
export function toSelectedOptionsInput(
  fields: ProductOptionField[],
  values: PurchaseValues['option'],
): CartSelectedOptionsInput {
  const input: Required<CartSelectedOptionsInput> = {
    multipleChoices: [],
    checkboxes: [],
    numberFields: [],
    textFields: [],
    multiLineTextFields: [],
    dateFields: [],
  };

  for (const field of fields) {
    const value = values[field.id];

    if (value === undefined || value === '') {
      continue;
    }

    const optionEntityId = Number(field.id);

    switch (field.type) {
      case 'swatch':
      case 'buttons':
      case 'radio':
      case 'select':
      case 'cards':
        input.multipleChoices.push({ optionEntityId, optionValueEntityId: Number(value) });
        break;

      case 'checkbox':
        input.checkboxes.push({ optionEntityId, optionValueEntityId: Number(value) });
        break;

      case 'number':
        input.numberFields.push({ optionEntityId, number: Number(value) });
        break;

      case 'text':
        input.textFields.push({ optionEntityId, text: String(value) });
        break;

      case 'textarea':
        input.multiLineTextFields.push({ optionEntityId, text: String(value) });
        break;

      case 'date':
        input.dateFields.push({ optionEntityId, date: toDateTime(String(value)) });
        break;

      default:
        break;
    }
  }

  return Object.fromEntries(
    Object.entries(input).filter(([, list]) => list.length > 0),
  ) as CartSelectedOptionsInput;
}
