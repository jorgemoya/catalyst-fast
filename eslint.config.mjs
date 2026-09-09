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
  {
    /**
     * `next-intl/server` is request-scoped and unusable from a cached scope.
     *
     * Not a style rule — it cost a real outage-shaped bug. `getTranslations()`
     * and `getFormatter()` cannot reach the request config from inside
     * `'use cache'`, so next-intl falls back to an **undefined locale and says
     * nothing**. One listing page render produced 336 `Incorrect locale
     * information provided` errors while the config resolved 5 times, and the
     * damage was invisible on plain lookups — only ICU-parameterized messages and
     * money formatting broke, on cached pages, in the non-default locale.
     *
     * `~/lib/i18n/server` does the same job from the locale root param, which is
     * part of the route rather than the request and therefore legal in a cached
     * body. `i18n/request.ts` is the one legitimate importer: `getRequestConfig`
     * is how the config is *defined*, not consumed.
     */
    files: ['app/**/*.{ts,tsx}', 'ui/**/*.{ts,tsx}', 'lib/**/*.{ts,tsx}', 'data/**/*.{ts,tsx}'],
    ignores: ['i18n/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next-intl/server',
              message:
                'Request-scoped: silently yields an undefined locale inside `use cache`. Use ~/lib/i18n/server, which reads the locale root param.',
            },
          ],
        },
      ],
    },
  },
  {
    /**
     * Links must carry the active locale.
     *
     * `next/link` renders the href verbatim, and an unprefixed href is read by
     * the proxy as the default locale — so a Spanish shopper clicking it lands in
     * English. That shipped: 29 of 29 internal links on `/es/` were unprefixed,
     * and the one component still importing `next/link` directly kept four of
     * them broken after the primitive was fixed.
     *
     * `~/ui/primitives/link` is the same component with `localizeHref` applied.
     * Catalog paths arrive from BigCommerce locale-blind (`/garden/`), so this
     * cannot be enforced at the data layer — the import boundary is the only
     * place it holds.
     */
    files: ['app/**/*.tsx', 'ui/**/*.tsx'],
    ignores: ['ui/primitives/link.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'next/link',
              message:
                'Use ~/ui/primitives/link, which prefixes internal hrefs with the active locale. A bare next/link sends non-default-locale shoppers back to the default locale.',
            },
          ],
        },
      ],
    },
  },
];

export default config;
