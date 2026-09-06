import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '~': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    // The domain layer is pure functions over plain data — no DOM, no server
    // runtime, no BigCommerce. That is the whole reason it lives in `domain/`
    // rather than inside the cached `data/` functions: it can be tested directly.
    //
    // `proxies/` is included for the same reason: the pure helpers in there
    // (route-key canonicalization, trailing-slash normalization) decide the
    // storefront's cache hit rate and are testable without a request.
    include: ['domain/**/*.spec.ts', 'lib/**/*.spec.ts', 'proxies/**/*.spec.ts'],
    environment: 'node',
  },
});
