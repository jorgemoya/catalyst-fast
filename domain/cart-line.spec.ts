import { describe, expect, it } from 'vitest';

import {
  purchaseSchema,
  toSelectedOptionsInput,
  type ValidationMessages,
} from './cart-line';
import type { ProductOptionField } from './product-options';

/**
 * The PDP form → BigCommerce cart line boundary.
 *
 * Worth testing closely because it is where a whole class of bug lives: every
 * option kind is a string in a form and a differently-shaped value in the API,
 * and getting the mapping wrong sends a shopper's engraving text where an
 * option-value id belongs. The Phase 3 audit found exactly that — a number
 * field's value going across as an option-value id — so the sorting is asserted
 * per kind rather than in aggregate.
 */

// Fixture messages: this layer takes copy as an argument, so the tests assert
// which rule fired without asserting English.
const messages: ValidationMessages = {
  required: 'REQUIRED',
  minLength: (min) => `MIN_LENGTH:${min}`,
  maxLength: (max) => `MAX_LENGTH:${max}`,
  min: (min) => `MIN:${min}`,
  max: (max) => `MAX:${max}`,
  invalidDate: 'INVALID_DATE',
};

const base = { required: false, variantDefining: false };

const choice = (id: string, required = false): ProductOptionField => ({
  ...base,
  id,
  label: 'Size',
  required,
  variantDefining: true,
  type: 'buttons',
  values: [{ label: 'L', value: '20', isDefault: false }],
});

const number = (id: string, extra: Partial<Extract<ProductOptionField, { type: 'number' }>> = {}) =>
  ({
    ...base,
    id,
    label: 'Quantity per pack',
    type: 'number',
    integerOnly: true,
    ...extra,
  }) as ProductOptionField;

const text = (id: string, extra: Record<string, unknown> = {}) =>
  ({ ...base, id, label: 'Engraving', type: 'text', ...extra }) as ProductOptionField;

const OPTION_PREFIX = 'option.';

/**
 * Mirrors conform's dotted-name nesting, so the schema is exercised in the shape
 * it actually receives from a submitted form rather than a hand-built one.
 */
const parse = (fields: ProductOptionField[], entries: Record<string, string>) => {
  const input: { quantity?: string; option: Record<string, string> } = { option: {} };

  for (const [key, value] of Object.entries(entries)) {
    if (key.startsWith(OPTION_PREFIX)) {
      input.option[key.slice(OPTION_PREFIX.length)] = value;
    } else {
      input.quantity = value;
    }
  }

  return purchaseSchema(fields, { min: 1, max: null }, messages).safeParse(input);
};

describe('purchaseSchema', () => {
  it('accepts a bare quantity when the product has no options', () => {
    const result = parse([], { quantity: '2' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.quantity).toBe(2);
  });

  it('coerces quantity from its string form and rejects below the minimum', () => {
    const schema = purchaseSchema([], { min: 2, max: 5 }, messages);

    expect(schema.safeParse({ quantity: '3' }).success).toBe(true);
    expect(schema.safeParse({ quantity: '1' }).error?.issues[0]?.message).toBe('MIN:2');
    expect(schema.safeParse({ quantity: '6' }).error?.issues[0]?.message).toBe('MAX:5');
  });

  it('reports a blank required option as required, not as a type error', () => {
    // A blank input arrives as '' rather than being absent, so without the
    // preprocess step zod would report "expected string, received undefined".
    const result = parse([text('7', { required: true })], { quantity: '1', 'option.7': '   ' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('REQUIRED');
  });

  it('treats a blank optional option as absent', () => {
    const result = parse([text('7')], { quantity: '1', 'option.7': '' });

    expect(result.success).toBe(true);
    expect(result.success && result.data.option['7']).toBeUndefined();
  });

  it('enforces text length bounds', () => {
    const fields = [text('7', { minLength: 3, maxLength: 5 })];

    expect(parse(fields, { quantity: '1', 'option.7': 'ab' }).error?.issues[0]?.message).toBe(
      'MIN_LENGTH:3',
    );
    expect(parse(fields, { quantity: '1', 'option.7': 'abcdef' }).error?.issues[0]?.message).toBe(
      'MAX_LENGTH:5',
    );
    expect(parse(fields, { quantity: '1', 'option.7': 'abcd' }).success).toBe(true);
  });

  it('enforces number bounds and integer-only', () => {
    const fields = [number('9', { min: 2, max: 4 })];

    expect(parse(fields, { quantity: '1', 'option.9': '1' }).error?.issues[0]?.message).toBe('MIN:2');
    expect(parse(fields, { quantity: '1', 'option.9': '5' }).error?.issues[0]?.message).toBe('MAX:4');
    expect(parse(fields, { quantity: '1', 'option.9': '2.5' }).success).toBe(false);
    expect(parse(fields, { quantity: '1', 'option.9': '3' }).success).toBe(true);
  });

  it('rejects an unparseable date', () => {
    const fields = [{ ...base, id: '4', label: 'Deliver on', type: 'date' } as ProductOptionField];

    expect(parse(fields, { quantity: '1', 'option.4': 'not-a-date' }).error?.issues[0]?.message).toBe(
      'INVALID_DATE',
    );
    expect(parse(fields, { quantity: '1', 'option.4': '2026-03-04' }).success).toBe(true);
  });
});

describe('toSelectedOptionsInput', () => {
  it('sorts each option kind into its own list', () => {
    const fields: ProductOptionField[] = [
      choice('1'),
      { ...base, id: '2', label: 'Gift wrap', type: 'checkbox', checkedValue: '30', uncheckedValue: '31', defaultChecked: false, variantDefining: true },
      number('3'),
      text('4'),
      { ...base, id: '5', label: 'Note', type: 'textarea' } as ProductOptionField,
      { ...base, id: '6', label: 'Deliver on', type: 'date' } as ProductOptionField,
    ];

    expect(
      toSelectedOptionsInput(fields, {
        '1': '20',
        '2': '30',
        '3': 7,
        '4': 'For Ana',
        '5': 'Happy birthday',
        '6': '2026-03-04',
      }),
    ).toEqual({
      multipleChoices: [{ optionEntityId: 1, optionValueEntityId: 20 }],
      checkboxes: [{ optionEntityId: 2, optionValueEntityId: 30 }],
      numberFields: [{ optionEntityId: 3, number: 7 }],
      textFields: [{ optionEntityId: 4, text: 'For Ana' }],
      multiLineTextFields: [{ optionEntityId: 5, text: 'Happy birthday' }],
      dateFields: [{ optionEntityId: 6, date: '2026-03-04T00:00:00.000Z' }],
    });
  });

  it('never routes a number field into multipleChoices', () => {
    // The Phase 3 regression: a quantity of 5 went to BigCommerce as if it were
    // option-value id 5. Structural now — the field's declared type decides the
    // destination, so a value can only land where its option kind says.
    const input = toSelectedOptionsInput([number('9')], { '9': 5 });

    expect(input.multipleChoices).toBeUndefined();
    expect(input.numberFields).toEqual([{ optionEntityId: 9, number: 5 }]);
  });

  it('omits kinds with no selections rather than sending empty lists', () => {
    // `[]` asserts "no choices of this kind"; absent means "not applicable".
    expect(toSelectedOptionsInput([choice('1')], { '1': '20' })).toEqual({
      multipleChoices: [{ optionEntityId: 1, optionValueEntityId: 20 }],
    });
  });

  it('returns an empty object for a product with no options', () => {
    expect(toSelectedOptionsInput([], {})).toEqual({});
  });

  it('ignores submitted values for options the catalog does not define', () => {
    // Driven by `fields`, not by the submitted keys — an injected key is dropped
    // rather than guessed at.
    expect(toSelectedOptionsInput([choice('1')], { '1': '20', '999': '404' })).toEqual({
      multipleChoices: [{ optionEntityId: 1, optionValueEntityId: 20 }],
    });
  });

  it('anchors a date at UTC midnight so the picked day cannot drift', () => {
    const input = toSelectedOptionsInput(
      [{ ...base, id: '6', label: 'Deliver on', type: 'date' } as ProductOptionField],
      { '6': '2026-01-01' },
    );

    expect(input.dateFields?.[0]?.date).toBe('2026-01-01T00:00:00.000Z');
  });
});
