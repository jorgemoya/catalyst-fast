import {
  UCP_PROXY_MARKER,
  buildDownstreamHeaders,
  buildUpstreamHeaders,
  buildUpstreamUrl,
  isUcpPath,
} from '~/lib/ucp/upstream';

import type { ProxyFactory } from './compose';

const UPSTREAM_TIMEOUT_MS = 15_000;
const METHODS_WITHOUT_BODY = ['GET', 'HEAD'];

/**
 * Forwards UCP requests to BigCommerce. Ported from Catalyst 1.12.0 (#3215).
 *
 * **Must run first in the chain**, before `withRoutes`: otherwise
 * `/.well-known/ucp` is treated as a storefront path, gets a locale prefix and a
 * route lookup, and 404s. Every non-UCP request passes straight through at the
 * cost of two regex tests.
 */
export const withUcpProxy: ProxyFactory = (next) => {
  return async (request, event) => {
    if (!isUcpPath(request.nextUrl.pathname)) {
      return next(request, event);
    }

    const upstreamUrl = buildUpstreamUrl(request.nextUrl);

    if (!upstreamUrl) {
      console.error(
        '[ucp] no upstream origin: BIGCOMMERCE_STORE_HASH or BIGCOMMERCE_CHANNEL_ID is unset.',
      );

      return Response.json({ error: 'Bad Gateway' }, { status: 502 });
    }

    // Misconfiguration guard: a request that has already been through here, or
    // an "upstream" that is this host, would recurse forever.
    if (request.headers.has(UCP_PROXY_MARKER) || upstreamUrl.host === request.nextUrl.host) {
      return Response.json({ error: 'UCP proxy loop detected' }, { status: 508 });
    }

    try {
      const body = METHODS_WITHOUT_BODY.includes(request.method)
        ? undefined
        : await request.arrayBuffer();

      const upstreamResponse = await fetch(upstreamUrl, {
        method: request.method,
        headers: buildUpstreamHeaders(request),
        body,
        // A redirect is part of the protocol response, for the agent to follow.
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: buildDownstreamHeaders(upstreamResponse.headers),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';

      console.error(`[ucp] failed to reach ${upstreamUrl.origin}`, error);

      return Response.json(
        { error: timedOut ? 'Gateway Timeout' : 'Bad Gateway' },
        { status: timedOut ? 504 : 502 },
      );
    }
  };
};
