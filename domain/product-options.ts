import type { ResultOf } from 'gql.tada';

import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import type { ProductOptionsFragment } from '~/lib/bigcommerce/fragments/product-options';

/**
 * Product option domain model — all eleven BigCommerce option types.
 *
 * Ported from `core/data-transformers/product-options-transformer.ts` with two
 * changes:
 *
 *  - **No i18n at this layer.** Upstream called `getTranslations()`, which is
 *    request-scoped and throws inside `use cache`. Labels come from BigCommerce;
 *    the few fixed strings belong in the component.
 *  - **`variantDefining` replaces `persist`.** Upstream's flag meant "write this
 *    to the URL". The distinction that actually matters is whether changing the
 *    option changes price, stock, or images — which is what decides whether a
 *    selection needs a server round trip at all. Text and date fields never do;
 *    they're collected purely to submit with the cart line.
 */

export interface OptionValue {
  label: string;
  value: string;
  isDefault: boolean;
}

export interface SwatchValue extends OptionValue {
  /** Image swatches take precedence over colors when BigCommerce supplies both. */
  image?: { src: string; alt: string };
  color?: string;
}

export interface CardValue extends OptionValue {
  image?: { src: string; alt: string };
}

interface BaseField {
  id: string;
  label: string;
  required: boolean;
  /** True when this option changes price, inventory, or imagery. */
  variantDefining: boolean;
}

export type ProductOptionField =
  | (BaseField & { type: 'swatch'; values: SwatchValue[]; defaultValue?: string })
  | (BaseField & { type: 'buttons'; values: OptionValue[]; defaultValue?: string })
  | (BaseField & { type: 'radio'; values: OptionValue[]; defaultValue?: string })
  | (BaseField & { type: 'select'; values: OptionValue[]; defaultValue?: string })
  | (BaseField & { type: 'cards'; values: CardValue[]; defaultValue?: string })
  | (BaseField & {
      type: 'checkbox';
      checkedValue: string;
      uncheckedValue: string;
      defaultChecked: boolean;
    })
  | (BaseField & {
      type: 'number';
      defaultValue?: number;
      min?: number;
      max?: number;
      integerOnly: boolean;
    })
  | (BaseField & { type: 'text'; defaultValue?: string; minLength?: number; maxLength?: number })
  | (BaseField & {
      type: 'textarea';
      defaultValue?: string;
      minLength?: number;
      maxLength?: number;
      maxLines?: number;
    })
  | (BaseField & { type: 'date'; defaultValue?: string; earliest?: string; latest?: string });

type Options = ResultOf<typeof ProductOptionsFragment>['productOptions'];
// The node type, extracted from the connection. `removeEdgesAndNodes` is generic
// over the *node*, so parameterizing it with the connection infers the wrong shape.
type OptionNode = NonNullable<Options['edges']>[number]['node'];

/**
 * `limitNumberBy` / `limitDateBy` are BigCommerce's way of saying which bounds
 * apply. `NO_LIMIT` means the `lowest`/`highest` values are present but
 * meaningless, so they are dropped rather than passed through as real bounds.
 */
const hasLowerBound = (limit: string | null | undefined): boolean =>
  limit === 'LOWEST_VALUE' || limit === 'RANGE' || limit === 'EARLIEST_DATE' || limit === 'RANGE_DATE';

const hasUpperBound = (limit: string | null | undefined): boolean =>
  limit === 'HIGHEST_VALUE' ||
  limit === 'RANGE' ||
  limit === 'LATEST_DATE' ||
  limit === 'RANGE_DATE';

 
function toField(option: OptionNode): ProductOptionField | null {
  const base = {
    id: String(option.entityId),
    label: option.displayName,
    required: option.isRequired,
  };

  if (option.__typename === 'MultipleChoiceOption') {
    const values = removeEdgesAndNodes(option.values);
    const defaultValue = values.find((value) => value.isDefault)?.entityId.toString();
    const plain = values.map((value) => ({
      label: value.label,
      value: String(value.entityId),
      isDefault: value.isDefault,
    }));

    // Every multiple-choice option can change the variant, so all six
    // presentations below are variant-defining.
    const choice = { ...base, variantDefining: true, defaultValue };

    switch (option.displayStyle) {
      case 'Swatch':
        return {
          ...choice,
          type: 'swatch',
          values: values
            .filter((value) => value.__typename === 'SwatchOptionValue')
            .map((value) => ({
              label: value.label,
              value: String(value.entityId),
              isDefault: value.isDefault,
              ...(value.imageUrl
                ? { image: { src: value.imageUrl, alt: value.label } }
                : { color: value.hexColors[0] ?? '' }),
            })),
        };

      case 'RectangleBoxes':
        return { ...choice, type: 'buttons', values: plain };

      case 'RadioButtons':
        return { ...choice, type: 'radio', values: plain };

      case 'DropdownList':
        return { ...choice, type: 'select', values: plain };

      case 'ProductPickList':
        return {
          ...choice,
          type: 'cards',
          values: values
            .filter((value) => value.__typename === 'ProductPickListOptionValue')
            .map((value) => ({
              label: value.label,
              value: String(value.entityId),
              isDefault: value.isDefault,
            })),
        };

      case 'ProductPickListWithImages':
        return {
          ...choice,
          type: 'cards',
          values: values
            .filter((value) => value.__typename === 'ProductPickListOptionValue')
            .map((value) => ({
              label: value.label,
              value: String(value.entityId),
              isDefault: value.isDefault,
              ...(value.defaultImage && {
                image: { src: value.defaultImage.url, alt: value.defaultImage.altText },
              }),
            })),
        };

      default:
        return null;
    }
  }

  switch (option.__typename) {
    case 'CheckboxOption':
      return {
        ...base,
        // A checkbox maps to two distinct option-value ids rather than a boolean,
        // and toggling it selects a different variant.
        variantDefining: true,
        type: 'checkbox',
        checkedValue: String(option.checkedOptionValueEntityId),
        uncheckedValue: String(option.uncheckedOptionValueEntityId),
        defaultChecked: option.checkedByDefault,
      };

    // The remaining four are personalization inputs — engraving text, a delivery
    // date, a quantity of something. They never change price or stock, so they
    // are collected for the cart line and never trigger a variant lookup.
    case 'NumberFieldOption':
      return {
        ...base,
        variantDefining: false,
        type: 'number',
        defaultValue: option.defaultNumber ?? undefined,
        min: hasLowerBound(option.limitNumberBy) ? (option.lowest ?? undefined) : undefined,
        max: hasUpperBound(option.limitNumberBy) ? (option.highest ?? undefined) : undefined,
        integerOnly: option.isIntegerOnly,
      };

    case 'TextFieldOption':
      return {
        ...base,
        variantDefining: false,
        type: 'text',
        defaultValue: option.defaultText ?? undefined,
        minLength: option.minLength ?? undefined,
        maxLength: option.maxLength ?? undefined,
      };

    case 'MultiLineTextFieldOption':
      return {
        ...base,
        variantDefining: false,
        type: 'textarea',
        defaultValue: option.defaultText ?? undefined,
        minLength: option.minLength ?? undefined,
        maxLength: option.maxLength ?? undefined,
        maxLines: option.maxLines ?? undefined,
      };

    case 'DateFieldOption':
      return {
        ...base,
        variantDefining: false,
        type: 'date',
        defaultValue: option.defaultDate ?? undefined,
        earliest: hasLowerBound(option.limitDateBy) ? (option.earliest ?? undefined) : undefined,
        latest: hasUpperBound(option.limitDateBy) ? (option.latest ?? undefined) : undefined,
      };

    default:
      // An option type BigCommerce adds later must not take the PDP down.
      return null;
  }
}

export function toProductOptions(options: Options): ProductOptionField[] {
  return removeEdgesAndNodes(options)
    .map(toField)
    .filter((field): field is ProductOptionField => field !== null);
}

/**
 * A shopper's option choices, keyed by option id.
 *
 * Keyed rather than a flat list of value ids because a value belongs to exactly
 * one option, and BigCommerce wants `{optionEntityId, valueEntityId}` pairs —
 * recovering the owning option from a flat list would mean searching every
 * option's values for each id.
 */
export type OptionSelection = Record<string, string>;

/**
 * The selection BigCommerce resolves a variant from when the shopper has chosen
 * nothing.
 *
 * Includes non-variant-defining fields (text, date, number) so the form has its
 * initial values; `toOptionValueIds` filters to what actually goes to
 * BigCommerce. A checkbox always contributes, since "unchecked" is a distinct
 * option value rather than an absence.
 */
export function defaultSelection(fields: ProductOptionField[]): OptionSelection {
  const selection: OptionSelection = {};

  for (const field of fields) {
    if (field.type === 'checkbox') {
      selection[field.id] = field.defaultChecked ? field.checkedValue : field.uncheckedValue;
    } else if ('defaultValue' in field && field.defaultValue !== undefined) {
      selection[field.id] = String(field.defaultValue);
    }
  }

  return selection;
}

/** Just the variant-defining choices — what price and inventory key on. */
export function variantSelection(
  fields: ProductOptionField[],
  selection: OptionSelection,
): OptionSelection {
  const variant: OptionSelection = {};

  for (const field of fields) {
    const value = selection[field.id];

    if (field.variantDefining && value !== undefined) {
      variant[field.id] = value;
    }
  }

  return variant;
}
