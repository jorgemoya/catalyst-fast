import { describe, expect, it, vi } from 'vitest';

import { createCustomerRouteMemo } from './customer-route-memo';

describe('createCustomerRouteMemo', () => {
  it('shares one lookup across concurrent requests for the same shopper and path', async () => {
    const memo = createCustomerRouteMemo<string>();
    const load = vi.fn(async () => 'route');

    await Promise.all([memo('t1', '/x/', load), memo('t1', '/x/', load), memo('t1', '/x/', load)]);

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('never serves one shopper another shopper’s answer', async () => {
    const memo = createCustomerRouteMemo<string>();

    await memo('alice', '/x/', async () => 'alice-route');

    await expect(memo('bob', '/x/', async () => 'bob-route')).resolves.toBe('bob-route');
  });

  it('expires', async () => {
    let clock = 0;
    const memo = createCustomerRouteMemo<number>({ ttlMs: 10, now: () => clock });
    const load = vi.fn(async () => clock);

    await memo('t', '/x/', load);
    clock = 11;
    await memo('t', '/x/', load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('forgets a failed lookup', async () => {
    const memo = createCustomerRouteMemo<string>();

    await expect(memo('t', '/x/', () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    await expect(memo('t', '/x/', async () => 'ok')).resolves.toBe('ok');
  });

  it('is bounded', async () => {
    const memo = createCustomerRouteMemo<string>({ maxEntries: 2 });
    const load = vi.fn(async () => 'r');

    await memo('t', '/a/', load);
    await memo('t', '/b/', load);
    await memo('t', '/c/', load); // evicts /a/
    await memo('t', '/a/', load);

    expect(load).toHaveBeenCalledTimes(4);
  });
});
