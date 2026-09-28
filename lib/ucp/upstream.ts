import { DEFAULT_LOCALE, channelFor } from '~/lib/config/channels';

/**
 * UCP (Universal Commerce Protocol) — agentic-commerce endpoints.
 *
 * Ported from Catalyst 1.12.0 (#3215) and 1.12.1-era fix #3224. Agents discover
 * and call UCP on the storefront's public domain, but it is **served by the
 * BigCommerce platform**, not by the storefront. So `/.well-known/ucp` and
 * `/api/ucp/*` are forwarded to the store's canonical channel origin.
 *
 * **The header allow-lists below are the security boundary** and are kept
 * verbatim from upstream rather than adapted. This forwards credentials
 * (`authorization`, `x-api-key`, signatures) to a separate origin, so the rule is
 * "only what the UCP REST transport spec defines, in either direction" — no
 * cookies, no forwarding headers, no internal markers leak out, and nothing the
 * platform sets beyond the spec reaches the agent.
 * Spec: https://ucp.dev/2026-04-08/specification/checkout-rest/
 */

/** Marks a request as already having passed through the proxy (loop guard). */
export const UCP_PROXY_MARKER = 'x-catalyst-ucp-proxy';

const FORWARDED_REQUEST_HEADERS = new Set([
  'accept',
  'accept-language',
  'authorization',
  'content-digest',
  'content-type',
  'idempotency-key',
  'if-match',
  'if-modified-since',
  'if-none-match',
  'if-unmodified-since',
  'origin',
  'request-id',
  'signature',
  'signature-agent',
  'signature-input',
  'ucp-agent',
  'user-agent',
  'x-api-key',
]);

const FORWARDED_REQUEST_HEADER_PREFIXES = ['ucp-', 'access-control-request-'];

const FORWARDED_RESPONSE_HEADERS = new Set([
  'access-control-allow-headers',
  'access-control-allow-methods',
  'access-control-allow-origin',
  'access-control-expose-headers',
  'access-control-max-age',
  'allow',
  'cache-control',
  'content-digest',
  'content-language',
  'content-type',
  'etag',
  'last-modified',
  'location',
  'request-id',
  'retry-after',
  'signature',
  'signature-input',
  'vary',
  'www-authenticate',
]);

const FORWARDED_RESPONSE_HEADER_PREFIXES = ['ucp-', 'ratelimit-', 'x-ratelimit-', 'x-rate-limit-'];

const copyAllowedHeaders = (source: Headers, allowed: Set<string>, prefixes: string[]): Headers => {
  const headers = new Headers();

  source.forEach((value, key) => {
    const name = key.toLowerCase();

    if (allowed.has(name) || prefixes.some((prefix) => name.startsWith(prefix))) {
      headers.set(key, value);
    }
  });

  return headers;
};

const UCP_PATHNAMES = [/^\/\.well-known\/ucp\/?$/u, /^\/api\/ucp(\/.*)?$/u];

export const isUcpPath = (pathname: string): boolean =>
  UCP_PATHNAMES.some((pattern) => pattern.test(pathname));

/*
 * The store's canonical origin — the same host the GraphQL client talks to —
 * **not** the channel's vanity URL. The storefront is the vanity URL, so
 * proxying there would loop straight back into this proxy.
 *
 * Always the default locale's channel. UCP is a store-level protocol with no
 * locale in its paths, matching upstream's `getChannelIdFromLocale()` with no
 * argument.
 */
const getUpstreamOrigin = (): string | null => {
  const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
  const { channelId } = channelFor(DEFAULT_LOCALE);

  if (!storeHash || !channelId) {
    return null;
  }

  const domain = process.env.BIGCOMMERCE_GRAPHQL_API_DOMAIN ?? 'mybigcommerce.com';

  return `https://store-${storeHash}-${channelId}.${domain}`;
};

/*
 * #3224: `trailingSlash: true` means every UCP path arrives here with a trailing
 * slash, and the platform answers one with a 307 to the bare path — which an
 * agent resolves against *our* domain and sends straight back, so the call never
 * lands. Upstream never sees a trailing slash.
 */
const stripTrailingSlash = (pathname: string): string => pathname.replace(/\/+$/u, '') || '/';

export const buildUpstreamUrl = (requestUrl: URL): URL | null => {
  const upstreamOrigin = getUpstreamOrigin();

  if (!upstreamOrigin) {
    return null;
  }

  // The platform verifies signed authority against the channel's storefront
  // host itself, so signatures are forwarded unchanged.
  const upstreamUrl = new URL(stripTrailingSlash(requestUrl.pathname), upstreamOrigin);

  upstreamUrl.search = requestUrl.search;

  return upstreamUrl;
};

/*
 * Credentials are among the forwarded headers on purpose: UCP authenticates the
 * calling agent at the platform, not at the storefront.
 */
export const buildUpstreamHeaders = (request: Request): Headers => {
  const headers = copyAllowedHeaders(
    request.headers,
    FORWARDED_REQUEST_HEADERS,
    FORWARDED_REQUEST_HEADER_PREFIXES,
  );

  // Uncompressed, so the body still matches the forwarded digest and signature.
  headers.set('accept-encoding', 'identity');
  headers.set(UCP_PROXY_MARKER, '1');

  return headers;
};

export const buildDownstreamHeaders = (upstreamHeaders: Headers): Headers =>
  copyAllowedHeaders(upstreamHeaders, FORWARDED_RESPONSE_HEADERS, FORWARDED_RESPONSE_HEADER_PREFIXES);
