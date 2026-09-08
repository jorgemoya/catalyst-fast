import { type NextRequest, NextResponse } from 'next/server';

import { getStoreSettings } from '~/data/settings';
import { BeaconSchema, requiredCategory } from '~/domain/analytics';
import { dispatch } from '~/lib/analytics';

/**
 * Analytics beacon.
 *
 * Catalyst fired analytics by seeding `Streamable` promises into the render and
 * dispatching from client leaves, which coupled measurement to the rendering
 * model: an event could not be sent without the component that owned its data
 * being rendered, and the data had to cross the RSC boundary as a promise to get
 * there. Here the page renders, a small client dispatcher POSTs here, and the
 * server fans out to providers. Rendering and measurement are independent.
 *
 * **Why the fan-out is server-side.** Provider SDKs in the browser are the
 * single largest source of third-party JavaScript on a typical storefront, and
 * they run on the critical path. Sending one small POST and doing the fan-out
 * here keeps that off the client entirely, and means adding a provider is a
 * server change with no bundle cost.
 *
 * Always answers 204. A beacon is fire-and-forget — `navigator.sendBeacon`
 * ignores the response, and a 4xx would produce console noise on a page the
 * shopper is already leaving. Rejections are counted server-side, not reported.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let parsed;

  try {
    parsed = BeaconSchema.safeParse(await request.json());
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  if (!parsed.success) {
    // Malformed or unknown event shape. Dropped silently: this endpoint is
    // public, so noisy logging here is a log-flooding vector.
    return new NextResponse(null, { status: 204 });
  }

  const { events, consent } = parsed.data;

  /*
   * The merchant's setting is authoritative and is read server-side. A client
   * cannot grant itself consent by claiming it: with consent enabled, an event
   * is only forwarded if the browser reported a granted category. With consent
   * disabled there is no banner and nothing to withhold.
   */
  const { cookieConsentEnabled } = await getStoreSettings();

  const permitted = events.filter((event) => {
    if (!cookieConsentEnabled) {
      return true;
    }

    return consent?.[requiredCategory(event)] === true;
  });

  if (permitted.length > 0) {
    // Not awaited into the response: the shopper's page is often unloading, and
    // provider latency must never delay the beacon completing.
    void dispatch(permitted);
  }

  return new NextResponse(null, { status: 204 });
}
