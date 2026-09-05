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
