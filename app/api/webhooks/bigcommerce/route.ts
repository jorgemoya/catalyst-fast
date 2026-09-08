import { timingSafeEqual } from 'node:crypto';
import { revalidateTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';

import { EventWindow, type WebhookPayload, tagsForScope } from '~/domain/webhooks';
import { tags } from '~/lib/cache/tags';
import { env } from '~/lib/env';

/**
 * BigCommerce webhook receiver — the piece Catalyst lacks entirely, and the
 * reason it needs a blanket 3600s revalidate on everything.
 *
 * With this in place a cached entry can be given a long life and dropped the
 * instant BigCommerce says it changed, which is what turns origin QPS from
 * "proportional to traffic" into "proportional to catalog change rate".
 *
 * Verified cross-instance before this was written: stamping a tag in the shared
 * KV store made a *different* server instance refetch exactly the operation
 * carrying that tag. See docs/phase-7-remote-cache.md — without that property
 * this endpoint would only ever fix the one instance that received the POST.
 *
 * `revalidateTag(tag, 'max')` and not `updateTag`: `updateTag` is only legal
 * inside a Server Action, and 'max' is the right semantic here anyway — serve
 * the stale entry and refresh behind it, rather than making the next visitor
 * wait for BigCommerce on a change they did not cause.
 */

/*
 * No `export const dynamic = 'force-dynamic'` here: route segment config is
 * rejected outright under `cacheComponents` ("not compatible with
 * nextConfig.cacheComponents"). It would be redundant anyway — POST handlers
 * that read the request body are dynamic by construction, and the GET below
 * returns a constant that is fine to cache.
 */
const eventWindow = new EventWindow();

/**
 * BigCommerce does not sign webhook bodies. The supported mechanism is a custom
 * header attached at subscription time, so `scripts/register-webhooks.ts` sets
 * this header and the receiver checks it.
 *
 * Compared in constant time: a plain `===` on a secret leaks its length and a
 * character-position oracle through timing, and this endpoint is
 * internet-reachable by definition.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = env.BIGCOMMERCE_WEBHOOK_SECRET;

  // No secret configured means the endpoint is not deployed for use. Fail
  // closed: an unauthenticated cache-purge endpoint is a denial-of-service lever
  // against your own origin.
  if (!secret) {
    return false;
  }

  const presented = request.headers.get('x-webhook-token') ?? '';
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);

  // timingSafeEqual throws on length mismatch, which would itself be an oracle.
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let payload: WebhookPayload;

  try {
    payload = (await request.json()) as WebhookPayload;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  if (typeof payload.scope !== 'string') {
    return NextResponse.json({ error: 'missing scope' }, { status: 400 });
  }

  /*
   * Storm coalescing. Past the threshold, stop honouring individual product
   * events and invalidate the collection once — see EventWindow for why this is
   * a cost guard rather than a correctness mechanism.
   */
  const saturated = eventWindow.record();

  if (saturated && payload.scope.startsWith('store/product')) {
    revalidateTag(tags.products, 'max');

    return NextResponse.json({ ok: true, coalesced: true, window: eventWindow.size });
  }

  const invalidated = tagsForScope(payload);

  for (const tag of invalidated) {
    revalidateTag(tag, 'max');
  }

  /*
   * Unmodelled scopes return 200 with an empty tag list rather than 4xx.
   * BigCommerce retries non-2xx with backoff and eventually deactivates a
   * failing subscription, so rejecting a scope we simply do not care about would
   * risk taking down the subscriptions we do.
   *
   * Tag *values* are deliberately not logged — they are plain text and the
   * session-scoped ones carry cart and customer ids (see lib/cache/tags.ts).
   * The count is enough to tell whether a webhook did anything.
   */
  return NextResponse.json({ ok: true, scope: payload.scope, invalidated: invalidated.length });
}

/**
 * BigCommerce probes the destination with a GET when a subscription is created.
 * Answering it keeps `register-webhooks.ts` from failing on an otherwise healthy
 * endpoint. Carries no data and requires no auth.
 */
export function GET(): NextResponse {
  return NextResponse.json({ ok: true, endpoint: 'bigcommerce-webhooks' });
}
