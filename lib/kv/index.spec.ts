import { afterEach, describe, expect, it, vi } from 'vitest';

import { createKVAdapter } from './index';

/**
 * Adapter selection order.
 *
 * `createKVAdapter` is exported *for this test* — the choice depends on ambient
 * state (env vars, a Cloudflare context global) that can't be observed through
 * the memoized singleton the app actually uses. Until this file existed, that
 * justification in the source comment was simply untrue.
 *
 * Worth covering because the failure mode is silent and deploy-shaped: pick the
 * wrong adapter and route resolution still *works*, it just stops being shared
 * across instances — every function gets its own memory cache, and the KV layer
 * quietly degrades to nothing on the exact traffic it exists to absorb.
 */

const ENV_KEYS = ['VERCEL', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;

afterEach(() => {
  for (const key of ENV_KEYS) {
    vi.stubEnv(key, '');
    delete process.env[key];
  }

  vi.unstubAllEnvs();
});

describe('createKVAdapter', () => {
  it('prefers Vercel’s runtime cache when running on Vercel', async () => {
    // Regionally colocated with the function, so cheapest by far — it has to win
    // even when Upstash is also configured.
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');

    expect((await createKVAdapter()).constructor.name).toBe('RuntimeCacheAdapter');
  });

  it('uses Upstash when it is configured and Vercel is not', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');

    expect((await createKVAdapter()).constructor.name).toBe('UpstashKvAdapter');
  });

  it('ignores a half-configured Upstash rather than constructing a broken client', async () => {
    // A URL with no token is a misconfiguration. Falling back to memory keeps the
    // storefront serving; constructing the client would throw at first use.
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://example.upstash.io');

    expect((await createKVAdapter()).constructor.name).toBe('MemoryKvAdapter');
  });

  it('falls back to in-memory when nothing is configured', async () => {
    expect((await createKVAdapter()).constructor.name).toBe('MemoryKvAdapter');
  });
});
