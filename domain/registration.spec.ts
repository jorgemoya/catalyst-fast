import { describe, expect, it } from 'vitest';

import { registerSchema } from './registration';

const valid = {
  firstName: 'Ana',
  lastName: 'Diaz',
  email: 'ana@example.com',
  password: 'correct-horse',
  confirmPassword: 'correct-horse',
};

describe('registerSchema', () => {
  it('accepts a complete registration', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true);
  });

  it('reports a password mismatch against the confirmation field', () => {
    // Pathed at `confirmPassword` so the message lands next to the input the
    // shopper has to fix, not at the top of the form.
    const result = registerSchema.safeParse({ ...valid, confirmPassword: 'different' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['confirmPassword']);
  });

  it('enforces a local minimum password length', () => {
    // Immediate feedback only — the store's real complexity rules are enforced
    // by BigCommerce and surfaced verbatim.
    expect(registerSchema.safeParse({ ...valid, password: 'short', confirmPassword: 'short' }).success).toBe(false);
  });

  it('rejects a malformed email', () => {
    expect(registerSchema.safeParse({ ...valid, email: 'nope' }).success).toBe(false);
  });

  it('keeps company and phone optional', () => {
    expect(registerSchema.safeParse({ ...valid, company: 'Acme', phone: '555' }).success).toBe(true);
  });
});
