import coreWebVitals from 'eslint-config-next/core-web-vitals';
import typescript from 'eslint-config-next/typescript';

/**
 * eslint-config-next 16 ships native flat configs, so these are spread directly.
 * (Wrapping them in `FlatCompat` fails — that shim is for legacy eslintrc-style
 * shareable configs, and these are already flat.)
 */
const config = [
  ...coreWebVitals,
  ...typescript,
  {
    ignores: ['.next/**', 'node_modules/**', 'bigcommerce-graphql.d.ts', 'bigcommerce.graphql'],
  },
  {
    rules: {
      // Underscore-prefixed params are deliberately unused — they exist to satisfy
      // an interface (e.g. KvAdapter.set's `_opts`, which Upstash uses and the
      // other adapters don't).
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // scripts/generate.cjs is CommonJS by necessity: it runs before the schema
    // types exist, via plain `node`, with no TS pipeline available.
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    /**
     * The public data-access boundary. `scripts/cache-audit.ts` enforces the same
     * rule structurally in CI; this surfaces it in the editor, at the moment the
     * import is written.
     *
     * Catalyst's central defect was that this boundary didn't exist — a
     * `customerAccessToken` parameter threaded into shared queries at ~76 call
     * sites, and its mere presence flipped each query to `no-store`.
     */
    files: ['data/**/*.ts'],
    ignores: ['data/customer/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next/headers',
              message:
                'Request APIs are illegal inside a public `use cache` scope. Take the value as an argument from a dynamic boundary instead.',
            },
            {
              name: 'next-intl/server',
              message:
                'Request-scoped translators throw inside `use cache`. Use the static translator in ~/lib/i18n/messages.',
            },
            {
              name: '~/lib/bigcommerce/customer',
              message:
                'data/ is the public layer. Customer-scoped reads belong in data/customer/.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
