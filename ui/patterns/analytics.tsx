'use client';

import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

import {
  CONSENT_COOKIE_NAME,
  type Consent,
  parseConsent,
} from '~/domain/consent';
import type { AnalyticsEvent } from '~/domain/analytics';

/**
 * Client-side event dispatch.
 *
 * Replaces Catalyst's `Streamable`-seeded analytics: instead of promises crossing
 * the RSC boundary so a leaf component can fire an event, a component declares
 * the event it represents and this posts it. No analytics data is prop-drilled,
 * and nothing about the page's data flow changes when an event is added.
 */

/*
 * The trailing slash is required, not stylistic.
 *
 * `trailingSlash: true` means `/api/events` answers **308** and only
 * `/api/events/` reaches the handler. `fetch` follows that redirect, so the
 * fallback path below works either way and the mistake is invisible in
 * development — but `navigator.sendBeacon`, which is the path essentially every
 * real shopper takes, does not follow redirects. Every event would be silently
 * dropped in production while looking perfectly healthy in a fetch-based test.
 *
 * This is the second time the same trailing-slash trap has bitten this codebase;
 * the webhook receiver has the identical note.
 */
const BEACON_URL = '/api/events/';

function readConsent(): Consent | null {
  const raw = document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${CONSENT_COOKIE_NAME}=`))
    ?.slice(CONSENT_COOKIE_NAME.length + 1);

  return parseConsent(raw ? decodeURIComponent(raw) : undefined);
}

/**
 * Posts events to `/api/events`.
 *
 * `navigator.sendBeacon` where available: a `fetch` issued during a navigation
 * is cancelled when the document unloads, which loses exactly the events fired
 * on the way out — an add-to-cart followed immediately by a click to the cart is
 * the common case. `sendBeacon` hands the request to the browser to complete
 * independently of the page.
 *
 * The consent snapshot travels with the request. The server re-checks the
 * merchant's setting, so this can only ever cause *fewer* events to be
 * forwarded, never more.
 */
export function sendEvents(events: AnalyticsEvent[]): void {
  if (events.length === 0) {
    return;
  }

  const consent = readConsent();
  const body = JSON.stringify({
    events,
    consent: consent
      ? {
          functionality: consent.functionality,
          marketing: consent.marketing,
          measurement: consent.measurement,
        }
      : undefined,
  });

  if (typeof navigator.sendBeacon === 'function') {
    // Blob rather than a bare string so the Content-Type is set; without it the
    // endpoint receives text/plain and `request.json()` still works, but the
    // intent is clearer and some proxies care.
    navigator.sendBeacon(BEACON_URL, new Blob([body], { type: 'application/json' }));

    return;
  }

  void fetch(BEACON_URL, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
    keepalive: true,
  }).catch(() => {
    // Analytics must never surface to a shopper.
  });
}

/*
 * Events already sent for the current page, keyed by pathname.
 *
 * Stored on `window` rather than in a ref, so it survives a remount: under PPR
 * the prerendered shell renders this component and the streamed result can
 * remount it, and a ref would reset. `window` is the only store guaranteed to be
 * one per document.
 *
 * A caution for anyone measuring this: a browser devtools or Playwright request
 * log shows *two* entries per event if the beacon URL redirects — the 308 and
 * the real request. That looks exactly like double-counting and is not. Check
 * the response statuses before concluding the dedupe is broken; see BEACON_URL.
 *
 * Keyed by pathname rather than globally so that genuinely revisiting a product
 * — A → B → A via client-side navigation — counts as two views, which it is.
 */
interface AnalyticsWindow extends Window {
  __cfSentEvents?: { path: string; keys: Set<string> };
}

function sentKeysFor(pathname: string): Set<string> {
  const store = window as AnalyticsWindow;

  // Replaced wholesale on a path change, which both scopes the dedupe to the
  // current page and stops the set growing for the lifetime of the tab.
  if (store.__cfSentEvents?.path !== pathname) {
    store.__cfSentEvents = { path: pathname, keys: new Set() };
  }

  return store.__cfSentEvents.keys;
}

const eventKey = (event: AnalyticsEvent): string => {
  switch (event.type) {
    case 'product_viewed':
      return `product_viewed:${event.productId}`;

    case 'category_viewed':
      return `category_viewed:${event.categoryId}`;

    default:
      return event.type;
  }
};

/**
 * Fires one event per page, once, however many times React mounts it.
 */
export function AnalyticsEventOnMount({ event }: { event: AnalyticsEvent }) {
  const pathname = usePathname();

  useEffect(() => {
    const sent = sentKeysFor(pathname);
    const key = eventKey(event);

    if (sent.has(key)) {
      return;
    }

    sent.add(key);
    sendEvents([event]);
  }, [event, pathname]);

  return null;
}
