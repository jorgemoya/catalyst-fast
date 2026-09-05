/**
 * Concurrency and retry controls for outbound BigCommerce requests.
 *
 * Not in the upstream client. Added because this architecture changes the load
 * shape: instead of every request hitting BigCommerce (Catalyst's `no-store`
 * path for logged-in users), origin traffic is concentrated into cache-miss
 * bursts. The sharpest of those is a deploy — `use cache: remote` entries are
 * keyed by buildId, so every deploy starts with a completely cold cache and the
 * first traffic wave arrives all at once.
 *
 * Two mitigations here:
 *   - a semaphore, so a burst queues instead of stampeding the origin
 *   - in-flight coalescing, so N concurrent requests for the same
 *     (operation, variables) collapse into one origin call
 */

export class Semaphore {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active < this.limit) {
      this.active += 1;

      return this.createRelease();
    }

    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });

    this.active += 1;

    return this.createRelease();
  }

  private createRelease(): () => void {
    let released = false;

    return () => {
      // Guard against a double release leaking capacity.
      if (released) {
        return;
      }

      released = true;
      this.active -= 1;
      this.queue.shift()?.();
    };
  }
}

/**
 * Collapses concurrent identical requests into a single in-flight promise.
 *
 * Deliberately only spans the time a request is actually in flight — this is
 * stampede protection, not a cache. Caching is `use cache`'s job.
 */
export class InFlightCoalescer {
  private inFlight = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key);

    if (existing) {
       
      return existing as Promise<T>;
    }

    const promise = task().finally(() => {
      this.inFlight.delete(key);
    });

    this.inFlight.set(key, promise);

    return promise;
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * Retry delay with full jitter. Jitter matters more than the backoff curve here:
 * without it, a synchronized burst (a deploy, a cache purge) retries in lockstep
 * and re-creates the same spike it was meant to spread out.
 *
 * Honors `Retry-After` when BigCommerce sends it, since that's authoritative.
 */
export function retryDelayMs(attempt: number, retryAfterHeader: string | null): number {
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);

    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000);
    }
  }

  const backoff = Math.min(2 ** attempt * 250, 8000);

  return Math.random() * backoff;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
