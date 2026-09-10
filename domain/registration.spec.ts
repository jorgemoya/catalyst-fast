import { describe, expect, it } from 'vitest';

import { registerSchema } from './registration';

/**
 * Fixture copy. The schema takes injected messages now, which is the point of
 * the injection: the domain stays free of any translator or locale.
 */
const messages = {
  required: 'required',
  invalidEmail: 'invalidEmail',
  passwordTooShort: (min: number) => `passwordTooShort:${min}`,
  passwordMismatch: 'passwordMismatch',
  passwordNeedsLowerCase: 'needsLowerCase',
  passwordNeedsUpperCase: 'needsUpperCase',
  passwordNeedsNumber: 'needsNumber',
  tooLong: (max: number) => `tooLong:${max}`,
  invalidNumber: 'invalidNumber',
};

const schema = registerSchema(messages);

const valid = {
  firstName: 'Ana',
  lastName: 'Diaz',
  email: 'ana@example.com',
  password: 'correct-horse',
  confirmPassword: 'correct-horse',
};

describe('schema', () => {
  it('accepts a complete registration', () => {
    expect(schema.safeParse(valid).success).toBe(true);
  });

  it('reports a password mismatch against the confirmation field', () => {
    // Pathed at `confirmPassword` so the message lands next to the input the
    // shopper has to fix, not at the top of the form.
    const result = schema.safeParse({ ...valid, confirmPassword: 'different' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['confirmPassword']);
  });

  it('enforces a local minimum password length', () => {
    // Immediate feedback only — the store's real complexity rules are enforced
    // by BigCommerce and surfaced verbatim.
    expect(schema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' }).success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(schema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
  });

  it('keeps company and phone optional', () => {
    expect(schema.safeParse({ ...valid, company: 'Acme', phone: '555' }).success).toBe(true);
  });
});
