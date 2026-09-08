import { type NextRequest, NextResponse } from 'next/server';

import { bc } from '~/lib/bigcommerce';

/**
 * GraphQL proxy for BigCommerce's `checkout-sdk-js`.
 *
 * Express-checkout wallet buttons (Apple Pay, Google Pay, PayPal) run in the
 * browser and expect to talk to a GraphQL endpoint on the storefront's own
 * origin. They cannot talk to BigCommerce directly — the storefront token would
 * have to be in the page — so a narrow proxy is the only way to support them.
 *
 * **This endpoint is the single most dangerous route in the storefront**, and
 * the allow-list below is the entire reason it is safe. Without it, anyone on
 * the internet could send arbitrary GraphQL through the store's own credentials:
 * enumerate customers, read orders, run mutations. So:
 *
 *   - Only named operations on the allow-list are forwarded.
 *   - The operation name is parsed from the document, not trusted from the body.
 *   - Nothing is cached, ever.
 *   - No customer access token is attached; the SDK carries its own session.
 *
 * Anything not explicitly permitted is rejected with 403 and no detail.
 */

/**
 * Operations `checkout-sdk-js` actually issues for wallet buttons.
 *
 * Deliberately a short, closed list rather than a prefix or pattern match. Add
 * an entry only when a wallet flow demonstrably needs it, and only after
 * checking what that operation can read — a permissive entry here silently
 * widens the store's entire attack surface.
 */
const ALLOWED_OPERATIONS = new Set([
  'createWalletSession',
  'createPaymentWalletIntent',
  'getPaymentWalletWithInitializationData',
  'updateWalletSession',
]);

/** Extracts the operation name from a GraphQL document. */
function operationName(query: string): string | null {
  const match = /\b(?:query|mutation)\s+(\w+)/.exec(query);

  return match?.[1] ?? null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: { query?: unknown; variables?: unknown; operationName?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ errors: [{ message: 'Invalid request' }] }, { status: 400 });
  }

  if (typeof body.query !== 'string') {
    return NextResponse.json({ errors: [{ message: 'Invalid request' }] }, { status: 400 });
  }

  /*
   * Parsed from the document rather than read from `body.operationName`. The
   * latter is a caller-supplied label with no necessary relationship to what the
   * document actually does — trusting it would let an attacker put an allowed
   * name on an arbitrary query and walk straight through the allow-list.
   */
  const name = operationName(body.query);

  if (!name || !ALLOWED_OPERATIONS.has(name)) {
    // No detail: whether an operation exists is itself information.
    return NextResponse.json({ errors: [{ message: 'Not permitted' }] }, { status: 403 });
  }

  try {
    const result = await bc.request({
      /*
       * Cast because every other caller passes a gql.tada document and gets a
       * typed result. This proxy is the one legitimate exception: it forwards a
       * document it did not author and cannot type, which is exactly why the
       * allow-list above exists — the type system cannot help here, so the
       * check has to.
       */
      document: body.query as unknown as Parameters<typeof bc.request>[0]['document'],
      variables: (body.variables ?? {}) as Record<string, unknown>,
      // The wallet SDK manages its own session; this proxy must never lend it
      // the shopper's customer token.
      fetchOptions: { cache: 'no-store' },
      // Errors are returned to the SDK, which knows how to interpret them,
      // rather than thrown here.
      errorPolicy: 'ignore',
    });

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    return NextResponse.json({ errors: [{ message: 'Upstream error' }] }, { status: 502 });
  }
}
