import { describe, expect, it } from 'vitest';

import { defaultSelection, toProductOptions, variantSelection } from './product-options';

/**
 * All eleven option types via fixtures.
 *
 * BigCommerce splits these across six GraphQL types, and `MultipleChoiceOption`
 * fans out into six presentations via `displayStyle` — so the eleven
 * shopper-visible controls come from a union narrowed twice. The demo store only
 * uses `RectangleBoxes`, so without fixtures ten of the eleven branches would be
 * written and never run.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const options = (...nodes: unknown[]): any => ({ edges: nodes.map((node) => ({ node })) });

const choice = (displayStyle: string, values: unknown[]) => ({
  __typename: 'MultipleChoiceOption',
  entityId: 1,
  displayName: 'Color',
  isRequired: true,
  displayStyle,
  values: { edges: values.map((node) => ({ node })) },
});

const value = (id: number, label: string, extra: Record<string, unknown> = {}) => ({
  entityId: id,
  label,
  isDefault: false,
  isSelected: false,
  ...extra,
});

describe('multiple-choice presentations', () => {
  it.each([
    ['RectangleBoxes', 'buttons'],
    ['RadioButtons', 'radio'],
    ['DropdownList', 'select'],
  ])('maps %s to %s', (displayStyle, expected) => {
    const [field] = toProductOptions(options(choice(displayStyle, [value(10, 'Red')])));

    expect(field).toMatchObject({ type: expected, label: 'Color', required: true });
  });

  it('maps a color swatch', () => {
    const [field] = toProductOptions(
      options(
        choice('Swatch', [
          value(10, 'Red', { __typename: 'SwatchOptionValue', hexColors: ['#f00'], imageUrl: null }),
        ]),
      ),
    );

    expect(field).toMatchObject({ type: 'swatch' });
    expect(field && 'values' in field && field.values[0]).toMatchObject({
      label: 'Red',
      color: '#f00',
    });
  });

  it('prefers an image swatch over a color when both are present', () => {
    const [field] = toProductOptions(
      options(
        choice('Swatch', [
          value(10, 'Oak', {
            __typename: 'SwatchOptionValue',
            hexColors: ['#fff'],
            imageUrl: 'https://cdn/oak.jpg',
          }),
        ]),
      ),
    );
    const swatch = field && 'values' in field ? field.values[0] : undefined;

    expect(swatch).toMatchObject({ image: { src: 'https://cdn/oak.jpg' } });
    expect(swatch && 'color' in swatch ? swatch.color : undefined).toBeUndefined();
  });

  it('maps both pick-list styles to cards, carrying images when present', () => {
    const [plain] = toProductOptions(
      options(
        choice('ProductPickList', [
          value(10, 'Fern', { __typename: 'ProductPickListOptionValue', defaultImage: null }),
        ]),
      ),
    );

    expect(plain).toMatchObject({ type: 'cards' });

    const [withImages] = toProductOptions(
      options(
        choice('ProductPickListWithImages', [
          value(11, 'Fern', {
            __typename: 'ProductPickListOptionValue',
            defaultImage: { url: 'https://cdn/fern.jpg', altText: 'Fern' },
          }),
        ]),
      ),
    );

    expect(withImages && 'values' in withImages && withImages.values[0]).toMatchObject({
      image: { src: 'https://cdn/fern.jpg', alt: 'Fern' },
    });
  });

  it('drops an unrecognized display style rather than crashing', () => {
    expect(toProductOptions(options(choice('SomeFutureStyle', [value(10, 'x')])))).toEqual([]);
  });

  it('marks every multiple-choice option as variant-defining', () => {
    const [field] = toProductOptions(options(choice('RectangleBoxes', [value(10, 'Red')])));

    expect(field?.variantDefining).toBe(true);
  });
});

describe('checkbox', () => {
  const checkbox = {
    __typename: 'CheckboxOption',
    entityId: 2,
    displayName: 'Gift wrap',
    isRequired: false,
    checkedByDefault: true,
    label: 'Gift wrap',
    checkedOptionValueEntityId: 90,
    uncheckedOptionValueEntityId: 91,
  };

  it('maps to two distinct option-value ids, not a boolean', () => {
    const [field] = toProductOptions(options(checkbox));

    expect(field).toMatchObject({
      type: 'checkbox',
      checkedValue: '90',
      uncheckedValue: '91',
      defaultChecked: true,
      variantDefining: true,
    });
  });
});

describe('personalization inputs', () => {
  const numberField = (limitNumberBy: string) => ({
    __typename: 'NumberFieldOption',
    entityId: 3,
    displayName: 'Quantity',
    isRequired: false,
    defaultNumber: 2,
    lowest: 1,
    highest: 10,
    isIntegerOnly: true,
    limitNumberBy,
  });

  it('is never variant-defining — these do not change price or stock', () => {
    const fields = toProductOptions(
      options(
        numberField('RANGE'),
        {
          __typename: 'TextFieldOption',
          entityId: 4,
          displayName: 'Engraving',
          isRequired: false,
          defaultText: 'Hi',
          minLength: 1,
          maxLength: 20,
        },
        {
          __typename: 'MultiLineTextFieldOption',
          entityId: 5,
          displayName: 'Note',
          isRequired: false,
          defaultText: '',
          minLength: null,
          maxLength: 200,
          maxLines: 4,
        },
        {
          __typename: 'DateFieldOption',
          entityId: 6,
          displayName: 'Deliver on',
          isRequired: false,
          defaultDate: '2026-01-01',
          earliest: '2025-01-01',
          latest: '2027-01-01',
          limitDateBy: 'RANGE_DATE',
        },
      ),
    );

    expect(fields).toHaveLength(4);
    expect(fields.every((field) => !field.variantDefining)).toBe(true);
    expect(fields.map((field) => field.type)).toEqual(['number', 'text', 'textarea', 'date']);
  });

  it('drops bounds when the merchant set no limit', () => {
    // `lowest`/`highest` are present but meaningless under NO_LIMIT; passing them
    // through would silently constrain an unconstrained input.
    const [field] = toProductOptions(options(numberField('NO_LIMIT')));

    expect(field).toMatchObject({ min: undefined, max: undefined });
  });

  it('keeps bounds under RANGE', () => {
    const [field] = toProductOptions(options(numberField('RANGE')));

    expect(field).toMatchObject({ min: 1, max: 10 });
  });

  it('applies only the lower bound under LOWEST_VALUE', () => {
    const [field] = toProductOptions(options(numberField('LOWEST_VALUE')));

    expect(field).toMatchObject({ min: 1, max: undefined });
  });
});

describe('defaultSelection', () => {
  it('includes every field that has a default, variant-defining or not', () => {
    const fields = toProductOptions(
      options(
        choice('RectangleBoxes', [value(10, 'Red', { isDefault: true }), value(11, 'Blue')]),
        {
          __typename: 'TextFieldOption',
          entityId: 4,
          displayName: 'Engraving',
          isRequired: false,
          defaultText: 'Hi',
          minLength: null,
          maxLength: null,
        },
      ),
    );

    // The form needs initial values for personalization fields too; filtering to
    // what BigCommerce resolves a variant from is `variantSelection`'s job.
    expect(defaultSelection(fields)).toEqual({ '1': '10', '4': 'Hi' });
  });

  it('always includes a checkbox, because unchecked is its own option value', () => {
    const make = (checkedByDefault: boolean) =>
      toProductOptions(
        options({
          __typename: 'CheckboxOption',
          entityId: 2,
          displayName: 'Gift wrap',
          isRequired: false,
          checkedByDefault,
          label: 'Gift wrap',
          checkedOptionValueEntityId: 90,
          uncheckedOptionValueEntityId: 91,
        }),
      );

    expect(defaultSelection(make(true))).toEqual({ '2': '90' });
    expect(defaultSelection(make(false))).toEqual({ '2': '91' });
  });
});

describe('variantSelection', () => {
  const fields = toProductOptions(
    options(
      choice('RectangleBoxes', [value(10, 'Red', { isDefault: true })]),
      {
        __typename: 'NumberFieldOption',
        entityId: 3,
        displayName: 'Quantity',
        isRequired: false,
        defaultNumber: 5,
        lowest: 1,
        highest: 10,
        isIntegerOnly: true,
        limitNumberBy: 'RANGE',
      },
    ),
  );

  it('drops non-variant fields before they reach BigCommerce', () => {
    // Without this a number field's value (5) would be sent as if it were an
    // option-value id — a real bug, not a tidiness concern.
    expect(variantSelection(fields, defaultSelection(fields))).toEqual({ '1': '10' });
  });

  it('ignores fields absent from the selection', () => {
    expect(variantSelection(fields, {})).toEqual({});
  });
});
