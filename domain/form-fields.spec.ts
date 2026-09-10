import { describe, expect, it } from 'vitest';

import {
  type CustomFormField,
  customFieldsSchema,
  fieldName,
  passwordSchema,
  toCustomFields,
  toFormFieldsInput,
} from './form-fields';

/**
 * Merchant-configured custom fields.
 *
 * These existed on the store and the forms never rendered them, which is a
 * failure with no symptom: the mutation accepts the omission, nothing errors,
 * and the merchant simply never receives the data they asked for. So the tests
 * that matter here are the ones asserting values actually reach the input.
 */

const messages = {
  required: 'required',
  tooLong: (max: number) => `tooLong:${max}`,
  invalidNumber: 'invalidNumber',
};

const raw = (over: Partial<Record<string, unknown>> = {}) => ({
  __typename: 'TextFormField',
  entityId: 10,
  label: 'Residence Type',
  sortOrder: 2,
  isBuiltIn: false,
  isRequired: false,
  ...over,
});

describe('toCustomFields', () => {
  it('drops built-ins, which the forms render by hand', () => {
    const fields = toCustomFields([raw({ isBuiltIn: true }), raw({ entityId: 11 })]);

    expect(fields.map((f) => f.id)).toEqual([11]);
  });

  /*
   * `PicklistOrTextFormField` has no member on `CustomerFormFieldsInput`, so a
   * value collected for it could never be submitted. Showing the field would be
   * worse than hiding it — the shopper fills it in and it silently evaporates.
   */
  it('drops field types that cannot be submitted', () => {
    expect(toCustomFields([raw({ __typename: 'PicklistOrTextFormField' })])).toEqual([]);
    expect(toCustomFields([raw({ __typename: 'PasswordFormField' })])).toEqual([]);
  });

  it('honours the merchant sort order rather than the API order', () => {
    const fields = toCustomFields([
      raw({ entityId: 1, sortOrder: 9 }),
      raw({ entityId: 2, sortOrder: 1 }),
    ]);

    expect(fields.map((f) => f.id)).toEqual([2, 1]);
  });

  it('carries the per-type constraints the renderer needs', () => {
    const [picklist] = toCustomFields([
      raw({
        __typename: 'PicklistFormField',
        choosePrefix: 'Choose one',
        options: [{ entityId: 5, label: 'House' }],
      }),
    ]);

    expect(picklist?.kind).toBe('picklist');
    expect(picklist?.choosePrefix).toBe('Choose one');
    expect(picklist?.options).toEqual([{ id: 5, label: 'House' }]);
  });
});

describe('toFormFieldsInput', () => {
  const field = (over: Partial<CustomFormField>): CustomFormField => ({
    id: 10,
    kind: 'text',
    label: 'Field',
    required: false,
    sortOrder: 1,
    ...over,
  });

  const formData = (entries: Array<[string, string]>) => {
    const data = new FormData();

    for (const [key, value] of entries) {
      data.append(key, value);
    }

    return data;
  };

  it('routes each kind to its own member of the input', () => {
    const fields = [
      field({ id: 1, kind: 'text' }),
      field({ id: 2, kind: 'multiline' }),
      field({ id: 3, kind: 'number' }),
      field({ id: 4, kind: 'picklist' }),
    ];

    const input = toFormFieldsInput(
      fields,
      formData([
        [fieldName(1), 'hello'],
        [fieldName(2), 'a note'],
        [fieldName(3), '42'],
        [fieldName(4), '7'],
      ]),
    );

    expect(input?.texts).toEqual([{ fieldEntityId: 1, text: 'hello' }]);
    expect(input?.multilineTexts).toEqual([{ fieldEntityId: 2, multilineText: 'a note' }]);
    expect(input?.numbers).toEqual([{ fieldEntityId: 3, number: 42 }]);
    expect(input?.multipleChoices).toEqual([{ fieldEntityId: 4, fieldValueEntityId: 7 }]);
  });

  /*
   * The reason this reads `FormData` rather than a parsed object: a checkbox
   * group submits its name repeatedly, and `Object.fromEntries` keeps only the
   * last — so every selection but one would vanish silently.
   */
  it('keeps every checkbox in a group, not just the last', () => {
    const input = toFormFieldsInput(
      [field({ id: 8, kind: 'checkboxes' })],
      formData([
        [fieldName(8), '1'],
        [fieldName(8), '2'],
        [fieldName(8), '3'],
      ]),
    );

    expect(input?.checkboxes).toEqual([{ fieldEntityId: 8, fieldValueEntityIds: [1, 2, 3] }]);
  });

  /*
   * "Left blank" and "answered with an empty string" are different, and
   * BigCommerce stores the difference.
   */
  it('omits fields the shopper left empty', () => {
    expect(toFormFieldsInput([field({ id: 1 })], formData([[fieldName(1), '   ']]))).toBeUndefined();
  });

  it('anchors a date at UTC midnight so the stored day is the day picked', () => {
    const input = toFormFieldsInput(
      [field({ id: 9, kind: 'date' })],
      formData([[fieldName(9), '2026-03-14']]),
    );

    expect(input?.dates).toEqual([{ fieldEntityId: 9, date: '2026-03-14T00:00:00Z' }]);
  });

  it('returns undefined when nothing was filled in, rather than an empty object', () => {
    expect(toFormFieldsInput([], new FormData())).toBeUndefined();
  });
});

describe('customFieldsSchema', () => {
  const base: CustomFormField = {
    id: 3,
    kind: 'text',
    label: 'Notes',
    required: false,
    sortOrder: 1,
  };

  it('makes a required field required and an optional one optional', () => {
    const optional = customFieldsSchema([base], messages);
    const required = customFieldsSchema([{ ...base, required: true }], messages);

    expect(optional[fieldName(3)]?.safeParse(undefined).success).toBe(true);
    expect(required[fieldName(3)]?.safeParse('').success).toBe(false);
  });

  it('enforces the merchant maxLength', () => {
    const shape = customFieldsSchema([{ ...base, maxLength: 3 }], messages);

    expect(shape[fieldName(3)]?.safeParse('abcd').success).toBe(false);
  });

  it('rejects a non-numeric value in a number field', () => {
    const shape = customFieldsSchema([{ ...base, kind: 'number', required: true }], messages);

    expect(shape[fieldName(3)]?.safeParse('twelve').success).toBe(false);
    expect(shape[fieldName(3)]?.safeParse('12').success).toBe(true);
  });
});

describe('passwordSchema', () => {
  const copy = {
    tooShort: (min: number) => `tooShort:${min}`,
    needsLowerCase: 'lower',
    needsUpperCase: 'upper',
    needsNumber: 'number',
  };

  /*
   * The store's minimum, not ours. A hardcoded 8 was rejecting passwords this
   * store's own setting of 7 accepts — stricter than the merchant asked for, and
   * invisible because the rejection never reaches BigCommerce.
   */
  it('uses the store minimum rather than a hardcoded one', () => {
    const seven = passwordSchema(
      { minLength: 7, requireLowerCase: false, requireUpperCase: false, requireNumbers: false },
      copy,
    );

    expect(seven.safeParse('1234567').success).toBe(true);
    expect(seven.safeParse('123456').success).toBe(false);
  });

  it('applies each complexity rule the store switched on', () => {
    const strict = passwordSchema(
      { minLength: 1, requireLowerCase: true, requireUpperCase: true, requireNumbers: true },
      copy,
    );

    expect(strict.safeParse('aB3').success).toBe(true);
    expect(strict.safeParse('abc').success).toBe(false);
    expect(strict.safeParse('ABC1').success).toBe(false);
  });

  it('ignores rules the store leaves off', () => {
    const lax = passwordSchema(
      { minLength: 1, requireLowerCase: false, requireUpperCase: false, requireNumbers: false },
      copy,
    );

    expect(lax.safeParse('aaaa').success).toBe(true);
  });
});
