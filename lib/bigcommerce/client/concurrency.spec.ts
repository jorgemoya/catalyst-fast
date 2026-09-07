import { describe, expect, it, vi } from 'vitest';

import {
  InFlightCoalescer,
  isRetryableNetworkError,
  isRetryableStatus,
  retryDelayMs,
  Semaphore,
} from './concurrency';

/**
 * The controls that decide how this storefront behaves when BigCommerce is slow,
 * rate-limiting, or unreachable. All of it matters most on a cold deploy, when
 * every cache miss fires at once — which is also the hardest state to reproduce,
 * so it is pinned here rather than discovered in production.
 */

describe('isRetryableNetworkError', () => {
  it('retries an undici connect timeout wrapped in a TypeError', () => {
    // The exact shape that failed a real `next build`: undici reports the code on
    // `cause`, not on the thrown error.
    const error = new TypeError('fetch failed');

    Object.assign(error, {
      cause: Object.assign(new Error('Connect Timeout Error'), {
        code: 'UND_ERR_CONNECT_TIMEOUT',
      }),
    });

    expect(isRetryableNetworkError(error)).toBe(true);
  });

  it('retries a reset connection and a transient DNS failure', () => {
    for (const code of ['ECONNRESET', 'EAI_AGAIN', 'ETIMEDOUT']) {
      expect(isRetryableNetworkError(Object.assign(new Error(code), { code }))).toBe(true);
    }
  });

  it('does NOT retry an aborted request', () => {
    // The caller cancelled on purpose; retrying would defeat the cancellation.
    const error = new Error('The operation was aborted');

    error.name = 'AbortError';
    Object.assign(error, { code: 'ECONNRESET' });

    expect(isRetryableNetworkError(error)).toBe(false);
  });

  it('does not retry an ordinary programming error', () => {
    expect(isRetryableNetworkError(new TypeError('x is not a function'))).toBe(false);
    expect(isRetryableNetworkError('not an error')).toBe(false);
    expect(isRetryableNetworkError(undefined)).toBe(false);
  });

  it('stops walking the cause chain rather than looping forever', () => {
    // A self-referencing cause is pathological but cheap to defend against, and
    // this runs on every failed request.
    const error = new Error('loop');

    Object.assign(error, { cause: error });

    expect(isRetryableNetworkError(error)).toBe(false);
  });
});

describe('isRetryableStatus', () => {
  it('covers rate limiting and gateway failures, not client errors', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(status)).toBe(true);
    }

    // Retrying a 401 or a 404 just burns the rate limit on a request that will
    // never succeed.
    for (const status of [400, 401, 403, 404, 422]) {
      expect(isRetryableStatus(status)).toBe(false);
    }
  });
});

describe('retryDelayMs', () => {
  it('honors Retry-After when BigCommerce sends it', () => {
    expect(retryDelayMs(0, '2')).toBe(2000);
  });

  it('caps a hostile Retry-After', () => {
    expect(retryDelayMs(0, '99999')).toBe(30_000);
  });

  it('ignores a malformed Retry-After and falls back to backoff', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);

    expect(retryDelayMs(0, 'tomorrow')).toBeLessThanOrEqual(250);

    vi.restoreAllMocks();
  });

  it('jitters rather than backing off in lockstep', () => {
    /*
     * Jitter matters more than the curve. A synchronized burst — a deploy, a
     * cache purge — that retries at identical intervals just re-creates the
     * spike it was meant to spread out.
     */
    vi.spyOn(Math, 'random').mockReturnValue(0);
    expect(retryDelayMs(3, null)).toBe(0);

    vi.spyOn(Math, 'random').mockReturnValue(0.999);
    expect(retryDelayMs(3, null)).toBeGreaterThan(1000);

    vi.restoreAllMocks();
  });

  it('caps the backoff so a long outage does not stall a request for minutes', () => {
    vi.spyOn(Math, 'random').mockReturnValue(1);

    expect(retryDelayMs(99, null)).toBeLessThanOrEqual(8000);

    vi.restoreAllMocks();
  });
});

describe('InFlightCoalescer', () => {
  it('collapses concurrent identical work into one call', async () => {
    const task = vi.fn(async () => 'result');
    const coalescer = new InFlightCoalescer();

    const [a, b, c] = await Promise.all([
      coalescer.run('k', task),
      coalescer.run('k', task),
      coalescer.run('k', task),
    ]);

    expect(task).toHaveBeenCalledTimes(1);
    expect([a, b, c]).toEqual(['result', 'result', 'result']);
  });

  it('keeps different keys independent', async () => {
    const task = vi.fn(async () => 'result');
    const coalescer = new InFlightCoalescer();

    await Promise.all([coalescer.run('a', task), coalescer.run('b', task)]);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('is stampede protection, not a cache — a later call re-runs', async () => {
    const task = vi.fn(async () => 'result');
    const coalescer = new InFlightCoalescer();

    await coalescer.run('k', task);
    await coalescer.run('k', task);

    expect(task).toHaveBeenCalledTimes(2);
  });

  it('does not wedge the key after a failure', async () => {
    // A rejected promise left in the map would make every later request for that
    // key replay the same error forever.
    const coalescer = new InFlightCoalescer();

    await expect(
      coalescer.run('k', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    await expect(coalescer.run('k', async () => 'recovered')).resolves.toBe('recovered');
  });
});

describe('Semaphore', () => {
  it('never exceeds its limit', async () => {
    const semaphore = new Semaphore(2);
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 8 }, async () => {
        const release = await semaphore.acquire();

        active += 1;
        peak = Math.max(peak, active);
        await Promise.resolve();
        active -= 1;
        release();
      }),
    );

    expect(peak).toBeLessThanOrEqual(2);
  });

  it('does not leak capacity when a release is called twice', async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();

    release();
    release();

    // If the double release had leaked a slot, two holders could now run at once.
    const first = await semaphore.acquire();
    let secondAcquired = false;

    void semaphore.acquire().then(() => {
      secondAcquired = true;
    });

    await Promise.resolve();
    expect(secondAcquired).toBe(false);

    first();
  });
});
