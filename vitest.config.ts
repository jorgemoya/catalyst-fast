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
    include: ['domain/**/*.spec.ts', 'lib/**/*.spec.ts'],
    environment: 'node',
  },
});
