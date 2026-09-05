/* eslint-disable @typescript-eslint/no-explicit-any */

/** Taken from the gql.tada repo — lets `client.request` infer result/variable types. */
export interface DocumentDecoration<Result = Record<string, any>, Variables = Record<string, any>> {
  /** Support for `@graphql-typed-document-node/core` @internal */
  __apiType?: (variables: Variables) => Result;
  /** Support for `TypedQueryDocumentNode` from `graphql` @internal */
  __ensureTypesOfVariablesAndResultMatching?: (variables: Variables) => Result;
}

export interface BigCommerceResponse<T> {
  data: T;
  errors?: unknown[];
}

/**
 * `none`   — throw on any GraphQL error (default).
 * `auth`   — throw only on auth-class errors; ignore the rest.
 * `all`    — return data alongside errors.
 * `ignore` — drop errors, return whatever data came back.
 */
export type GraphQLErrorPolicy = 'none' | 'all' | 'auth' | 'ignore';

export interface ClientConfig {
  storeHash: string;
  storefrontToken: string;
  channelId: string;
  graphqlApiDomain?: string;
  trustedProxySecret?: string;
  /** Appended to the User-Agent, e.g. `catalyst-fast/0.0.0 (abc123)`. */
  userAgentExtensions?: string;
  logger?: boolean;
  /**
   * Ceiling on simultaneous in-flight requests to BigCommerce. Requests beyond
   * this queue rather than pile onto the origin. Matters most on a cold cache
   * after a deploy — remote cache entries are keyed by buildId, so every deploy
   * starts cold and the first traffic wave would otherwise hit BC at full force.
   */
  maxConcurrency?: number;
}

export interface ClientRequest<TResult, TVariables> {
  document: DocumentDecoration<TResult, TVariables>;
  variables?: TVariables;
  /** Explicit. Never resolved from request-scoped state — that would break `use cache`. */
  channelId?: string;
  /** Explicit. Only ever supplied by `customerQuery`, never from inside a cached body. */
  customerAccessToken?: string;
  /** Explicit. Replaces the upstream client's `beforeRequest` hook. */
  headers?: Record<string, string>;
  fetchOptions?: RequestInit;
  errorPolicy?: GraphQLErrorPolicy;
  validateCustomerAccessToken?: boolean;
}
