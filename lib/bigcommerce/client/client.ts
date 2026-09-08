import {
  InFlightCoalescer,
  isRetryableNetworkError,
  isRetryableStatus,
  retryDelayMs,
  Semaphore,
  sleep,
} from './concurrency';
import {
  BigCommerceAPIError,
  BigCommerceAuthError,
  InvalidStorefrontTokenError,
  parseGraphQLError,
} from './errors';
import type { BigCommerceResponse, ClientConfig, ClientRequest } from './types';
import { attr, traceQuery } from '../../telemetry/index.ts';

import { getBackendUserAgent, getOperationInfo, looksLikeJwt, normalizeQuery } from './utils';

const CLIENT_NAME = 'catalyst-fast-client';
const CLIENT_VERSION = '0.0.0';
const MAX_ATTEMPTS = 3;

/**
 * BigCommerce Storefront GraphQL client.
 *
 * Vendored from `packages/client/src/client.ts` and **purified**: the upstream
 * `getChannelId`, `beforeRequest`, and `onError` hooks are gone.
 *
 * That removal is the point of vendoring. Upstream, `beforeRequest` called
 * `getLocale()` and conditionally `headers()`, and `getChannelId` called
 * `getLocale()` — all request-scoped APIs that throw or force dynamic rendering
 * inside a `'use cache'` body. Catalyst needed a pile of dynamic-`import()`
 * workarounds to keep those from poisoning AsyncLocalStorage when
 * `next.config.ts` imported the client.
 *
 * Here the client is a pure function of its arguments and imports nothing from
 * Next. Channel id, customer token, and extra headers are all explicit
 * parameters. `onError`'s `redirect('/api/auth/signout')` side effect moved up to
 * `lib/bigcommerce/customer.ts`, where it is legal — a redirect thrown from
 * inside a cached body is a landmine.
 */
export class BigCommerceClient {
  private readonly userAgent: string;
  private readonly graphqlApiDomain: string;
  private readonly semaphore: Semaphore;
  private readonly coalescer = new InFlightCoalescer();

  constructor(private readonly config: ClientConfig) {
    if (!config.storeHash) {
      throw new Error('BigCommerce client requires a storeHash.');
    }

    if (!config.channelId) {
      throw new Error('BigCommerce client requires a channelId.');
    }

    this.graphqlApiDomain = config.graphqlApiDomain ?? 'mybigcommerce.com';
    this.userAgent = getBackendUserAgent(
      CLIENT_NAME,
      CLIENT_VERSION,
      config.userAgentExtensions,
    );
    this.semaphore = new Semaphore(config.maxConcurrency ?? 16);
  }

  /**
   * Single, non-overloaded signature on purpose. The ergonomic
   * "variables required vs. forbidden" overloads live on `query()` and
   * `customerQuery()` in the layer above — putting them here too made every
   * generic call site fail to select an overload, since `TVariables` can't be
   * proven assignable to either `Record<string, unknown>` or `Record<string, never>`.
   */
  async request<TResult, TVariables>({
    document,
    variables,
    channelId,
    customerAccessToken,
    headers = {},
    fetchOptions = {},
    errorPolicy = 'none',
    validateCustomerAccessToken = true,
  }: ClientRequest<TResult, TVariables>): Promise<BigCommerceResponse<TResult>> {
    const query = normalizeQuery(document);
    const operation = getOperationInfo(query);
    const url = this.buildEndpoint(channelId, operation?.name, operation?.type);
    const body = JSON.stringify({ query, ...(variables && { variables }) });

    /*
     * Every call that gets here is a cache miss by construction — a cached
     * function that hits never runs its body, so it never reaches the client.
     * That makes this the correct and only place to count origin load.
     */
    const send = async (): Promise<BigCommerceResponse<TResult>> =>
      traceQuery(operation?.name ?? 'anonymous', async (span) => {
        const response = await this.fetchWithRetry(url, body, {
          headers,
          customerAccessToken,
          validateCustomerAccessToken,
          fetchOptions,
        });

        span.setAttribute(attr.status, response.status);

        const complexity = response.headers.get('x-bc-graphql-complexity');

        if (complexity) {
          // BigCommerce enforces a complexity budget per request; p99 on this
          // is the signal that a query has quietly grown too broad.
          span.setAttribute(attr.complexity, Number(complexity));
        }

        const result = (await response.json()) as BigCommerceResponse<TResult>;
        const { errors, ...data } = result;

        if (errors) {
          const error = parseGraphQLError(errors);

          if (errorPolicy === 'none') {
            throw error;
          }

          if (errorPolicy === 'auth' && error instanceof BigCommerceAuthError) {
            throw error;
          }
        }

        if (errorPolicy === 'ignore') {
          return data as BigCommerceResponse<TResult>;
        }

        return result;
      });

    // Only coalesce anonymous reads. Customer-scoped requests must never share a
    // response across identities, and mutations must never be deduplicated.
    if (customerAccessToken || operation?.type === 'mutation') {
      return send();
    }

    return this.coalescer.run(`${url}::${body}`, send);
  }

  /** Fetches BigCommerce's native sitemap index, used by `app/sitemap.xml`. */
  async fetchSitemapIndex(channelId?: string): Promise<string> {
    const response = await fetch(`${this.getCanonicalUrl(channelId)}/xmlsitemap.php`, {
      method: 'GET',
      headers: {
        Accept: 'application/xml',
        'Content-Type': 'application/xml',
        'User-Agent': this.userAgent,
        ...(this.config.trustedProxySecret && {
          'X-BC-Trusted-Proxy-Secret': this.config.trustedProxySecret,
        }),
      },
    });

    if (!response.ok) {
      throw new Error(`Unable to get sitemap index: ${response.statusText}`);
    }

    return response.text();
  }

  private async fetchWithRetry(
    url: string,
    body: string,
    options: {
      headers: Record<string, string>;
      customerAccessToken?: string;
      validateCustomerAccessToken: boolean;
      fetchOptions: RequestInit;
    },
  ): Promise<Response> {
    const release = await this.semaphore.acquire();

    try {
      for (let attempt = 0; ; attempt += 1) {
        const startedAt = performance.now();
        let response: Response;

        try {
          response = await fetch(url, {
            method: 'POST',
            headers: this.buildHeaders(options),
            body,
            ...options.fetchOptions,
          });
        } catch (error) {
          // A transport failure never becomes a response, so the status checks
          // below can't see it. Without this, one connect timeout during
          // prerendering fails an entire `next build`.
          if (isRetryableNetworkError(error) && attempt < MAX_ATTEMPTS - 1) {
            await sleep(retryDelayMs(attempt, null));
            continue;
          }

          throw error;
        }

        if (response.ok) {
          this.log(url, response, startedAt);

          return response;
        }

        if (isRetryableStatus(response.status) && attempt < MAX_ATTEMPTS - 1) {
          await sleep(retryDelayMs(attempt, response.headers.get('Retry-After')));
          continue;
        }

        if (response.status === 401 && !looksLikeJwt(this.config.storefrontToken)) {
          throw new InvalidStorefrontTokenError(response.status);
        }

        throw await BigCommerceAPIError.createFromResponse(response);
      }
    } finally {
      release();
    }
  }

  private buildHeaders({
    headers,
    customerAccessToken,
    validateCustomerAccessToken,
  }: {
    headers: Record<string, string>;
    customerAccessToken?: string;
    validateCustomerAccessToken: boolean;
  }): Headers {
    // A Headers object rather than a plain object so case-insensitive overrides
    // behave as callers expect.
    const requestHeaders = new Headers({
      'Content-Type': 'application/json',
      // Store-level auth. Separate from, and independent of, customer identity.
      Authorization: `Bearer ${this.config.storefrontToken}`,
      'User-Agent': this.userAgent,
    });

    if (customerAccessToken) {
      requestHeaders.set('X-Bc-Customer-Access-Token', customerAccessToken);
    }

    if (validateCustomerAccessToken) {
      requestHeaders.set('X-Bc-Error-On-Invalid-Customer-Access-Token', 'true');
    }

    if (this.config.trustedProxySecret) {
      requestHeaders.set('X-BC-Trusted-Proxy-Secret', this.config.trustedProxySecret);
    }

    for (const [key, value] of Object.entries(headers)) {
      requestHeaders.set(key, value);
    }

    return requestHeaders;
  }

  private getCanonicalUrl(channelId?: string): string {
    const resolved = channelId ?? this.config.channelId;

    return `https://store-${this.config.storeHash}-${resolved}.${this.graphqlApiDomain}`;
  }

  private buildEndpoint(channelId?: string, operationName?: string, operationType?: string): string {
    const url = new URL(`${this.getCanonicalUrl(channelId)}/graphql`);

    // BigCommerce surfaces these in their own logging; keep sending them.
    if (operationName) {
      url.searchParams.set('operation', operationName);
    }

    if (operationType) {
      url.searchParams.set('type', operationType);
    }

    return url.toString();
  }

  private log(url: string, response: Response, startedAt: number): void {
    if (!this.config.logger) {
      return;
    }

    const duration = (performance.now() - startedAt).toFixed(2);
    const operation = new URL(url).searchParams.get('operation') ?? 'anonymous';
    // Worth watching: BigCommerce enforces a complexity budget, and splitting
    // queries by cache key rather than by page can move this around.
    const complexity = response.headers.get('x-bc-graphql-complexity') ?? 'unknown';

     
    console.log(`[BigCommerce] ${operation} - ${duration}ms - complexity ${complexity}`);
  }
}

export function createClient(config: ClientConfig): BigCommerceClient {
  return new BigCommerceClient(config);
}
