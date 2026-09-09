import builder from 'content-security-policy-builder';

// Ported from core/lib/content-security-policy.ts, minus the Makeswift branch
// (no visual-editor integration here). Add directives as features land — each
// one is a deliberate decision, so they stay commented rather than guessed at.
export const cspHeader = builder({
  directives: {
    baseUri: ['self'],
    frameAncestors: ['none'],
    // formAction: ['self'],
    // defaultSrc: ['self'],
    // scriptSrc: ['self'],
    // styleSrc: ['self'],
    // imgSrc: ['self'],
    // connectSrc: ['self'],
    // fontSrc: ['self'],
    // objectSrc: ['none'],
  },
});

/*
 * When these directives are switched on, the Phase 7 features need the
 * following. Recorded here rather than enabled piecemeal, because a partially
 * correct CSP fails *silently* in the browser console and the symptom — a
 * reCAPTCHA that never returns a token, so every review submission is rejected —
 * points nowhere near this file.
 *
 *   scriptSrc   https://www.google.com https://www.gstatic.com   (reCAPTCHA v3)
 *   frameSrc    https://www.google.com                           (its hidden iframe)
 *   connectSrc  'self'                                           (the /api/events beacon)
 *   imgSrc      https://cdn11.bigcommerce.com                    (product imagery)
 *   fontSrc     'self'                                           (fonts are vendored — see app/layout.tsx)
 *
 * Wallet buttons need more, and they are the reason to get this right before
 * enabling anything: the SDK is fetched from BigCommerce's CDN at runtime and
 * each provider mounts a cross-origin iframe.
 *
 *   scriptSrc   https://checkout-sdk.bigcommerce.com              (the loader)
 *   connectSrc  'self'                                            (SDK GraphQL, via /graphql)
 *   frameSrc    the provider origins Apple Pay / Google Pay /
 *               PayPal mount into — determined by which wallets
 *               the merchant enables, so they cannot be listed
 *               ahead of that decision
 *
 * Analytics needs no entries: the provider fan-out happens server-side, which is
 * most of the reason it was built that way.
 */
