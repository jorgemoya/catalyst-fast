import 'server-only';

import { cookies } from 'next/headers';

import { getStoreSettings } from '~/data/settings';
import { CONSENT_COOKIE_NAME, hasConsentFor, parseConsent } from '~/domain/consent';

/**
 * Visitor identity for BigCommerce analytics attribution.
 *
 * BigCommerce ties a hosted-checkout session back to the storefront visit that
 * produced it, using a visitor id (who) and a visit id (which session). Without
 * them an order arrives at BigCommerce's analytics unattributed — it happened,
 * but not *because of* anything.
 *
 * **Minted here, at the checkout handoff, rather than in the proxy.** Catalyst
 * runs a `withAnalyticsCookies` proxy that mints ids on the first pageview and
 * fires a `visitStarted` event. That is the more complete design and it is
 * deliberately not what this does: every proxy runs on every request ahead of
 * Next's routing — including prefetches and RSC navigations — so it is a tax on
 * the entire storefront, and `proxy.ts` says as much.
 *
 * What that costs, stated plainly: the visit id begins at checkout rather than at
 * the first pageview, so BigCommerce sees the session but not the browsing that
 * led to it, and no `visitStarted` event is emitted. The visitor id **does**
 * persist for a year, so repeat customers are still recognised across orders.
 * Moving to the proxy later is additive — this module keeps the same shape and
 * the route handler does not change.
 *
 * **Consent gates identity, not context.** `AnalyticsEventInitiatorInput` is
 * nullable while `request` and `consent` are not, which is exactly the right
 * shape: a shopper who declined measurement still has their *decision* forwarded
 * to BigCommerce — that is what makes it binding downstream — along with the
 * request context, but carries no identifier.
 */

/** A year. Identity that outlives a session is the point of a visitor id. */
const VISITOR_MAX_AGE = 60 * 60 * 24 * 365;

/** Thirty minutes, refreshed on use — the conventional session window. */
const VISIT_MAX_AGE = 60 * 30;

export const VISITOR_COOKIE = 'cf.visitor';
export const VISIT_COOKIE = 'cf.visit';

export interface AnalyticsConsentFlags {
  analytics: boolean;
  functional: boolean;
  targeting: boolean;
}

export interface Attribution {
  /** Absent when the shopper has not consented to measurement. */
  initiator: { visitId: string; visitorId: string } | null;
  consent: AnalyticsConsentFlags;
}

/*
 * The schema types these as `UUID`, so they must parse as one. `randomUUID` is
 * available on the Web Crypto global in every runtime this ships to.
 */
const isUuid = (value: string | undefined): value is string =>
  value !== undefined &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);

export async function resolveAttribution(): Promise<Attribution> {
  const [store, settings] = await Promise.all([cookies(), getStoreSettings()]);
  const consent = parseConsent(store.get(CONSENT_COOKIE_NAME)?.value);
  const enabled = settings.cookieConsentEnabled;

  const flags: AnalyticsConsentFlags = {
    analytics: hasConsentFor(consent, 'measurement', enabled),
    functional: hasConsentFor(consent, 'functionality', enabled),
    targeting: hasConsentFor(consent, 'marketing', enabled),
  };

  if (!flags.analytics) {
    /*
     * Clear anything left from before consent was withdrawn. Leaving the cookies
     * in place would mean a shopper who declines is still carrying the
     * identifier that a previous "accept" created.
     */
    for (const name of [VISITOR_COOKIE, VISIT_COOKIE]) {
      if (store.get(name)) {
        store.delete(name);
      }
    }

    return { initiator: null, consent: flags };
  }

  const existingVisitor = store.get(VISITOR_COOKIE)?.value;
  const existingVisit = store.get(VISIT_COOKIE)?.value;

  const visitorId = isUuid(existingVisitor) ? existingVisitor : crypto.randomUUID();
  const visitId = isUuid(existingVisit) ? existingVisit : crypto.randomUUID();

  const options = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  } as const;

  store.set(VISITOR_COOKIE, visitorId, { ...options, maxAge: VISITOR_MAX_AGE });
  // Written every time, so the visit window slides while the shopper is active.
  store.set(VISIT_COOKIE, visitId, { ...options, maxAge: VISIT_MAX_AGE });

  return { initiator: { visitId, visitorId }, consent: flags };
}
