import { initGraphQLTada } from 'gql.tada';

import type { introspection } from '~/bigcommerce-graphql';

/**
 * Typed GraphQL document builder. Run `npm run generate` to (re)create
 * `bigcommerce.graphql` + `bigcommerce-graphql.d.ts` from the live schema.
 *
 * `disableMasking: true` matches Catalyst: fragments aren't runtime-masked, which
 * trades enforced fragment colocation for simpler consumption. Keeping the same
 * choice means fragments port over without reshaping.
 */
export const graphql = initGraphQLTada<{
  introspection: introspection;
  scalars: {
    DateTime: string;
    Long: number;
    BigDecimal: number;
    UUID: string;
  };
  disableMasking: true;
}>();

export type { FragmentOf, ResultOf, VariablesOf } from 'gql.tada';
export { readFragment } from 'gql.tada';
