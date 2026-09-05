import rawBuildConfig from './build-config.json';
import { buildConfigSchema, type BuildConfigSchema } from './schema';

/**
 * Reads the build-time snapshot written by `scripts/build-config.ts` (run as
 * `prebuild`/`predev`). Synchronous and side-effect-free, so it is safe to call
 * from `next.config.ts`, from inside a `'use cache'` body, and from a client
 * component alike.
 *
 * Note this file is imported by `next.config.ts`. It must never reach for the
 * BigCommerce client, `next/headers`, or anything else request-scoped —
 * Catalyst's `next.config.ts` imported its GraphQL client and needed a pile of
 * dynamic-`import()` workarounds to stop that poisoning AsyncLocalStorage. The
 * prebuild script exists specifically so we don't inherit that problem.
 */
class BuildConfig {
  private config = buildConfigSchema.parse(rawBuildConfig);

  get<K extends keyof BuildConfigSchema>(key: K): BuildConfigSchema[K] {
    return this.config[key];
  }
}

export const buildConfig = new BuildConfig();
export type { BuildConfigSchema };
