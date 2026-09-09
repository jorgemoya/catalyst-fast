import { graphql } from './graphql';

/**
 * BigCommerce's `currencyCode` is a 288-member enum, not a string, so gql.tada
 * rejects a plain `string` in query variables.
 *
 * The rest of the app deliberately passes currency around as `string`:
 * `lib/config/channels.ts` is plain configuration and `domain/` is pure, and
 * neither should have to import GraphQL types to describe money. This is the one
 * place the two meet.
 */
export type CurrencyCode = ReturnType<typeof graphql.scalar<'currencyCode'>>;

/**
 * Narrows a validated currency string for use as a query variable.
 *
 * **The cast is safe because of where the value came from**, not because of
 * anything checked here: every currency reaching a data function has already
 * been through `resolveCurrency`, which only ever returns a code BigCommerce
 * reports as transactional (or the locale's default). A currency that failed
 * that check was replaced long before this point — which is also what stops a
 * shopper-supplied `?currency=AAA` from reaching a cache key.
 */
export function toCurrencyCode(currency: string): CurrencyCode {
  return currency as CurrencyCode;
}
