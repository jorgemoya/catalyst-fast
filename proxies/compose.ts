import { type NextProxy, NextResponse } from 'next/server';

export type ProxyFactory = (proxy: NextProxy) => NextProxy;

/**
 * Onion-style combinator: each factory wraps the next, innermost last.
 * Ported from core/proxies/compose-proxies.ts.
 */
export const composeProxies = (
  firstProxyWrapper: ProxyFactory,
  ...otherProxyWrappers: ProxyFactory[]
): NextProxy => {
  const proxies = otherProxyWrappers.reduce(
    (accumulated, next) => (proxy) => accumulated(next(proxy)),
    firstProxyWrapper,
  );

  return proxies(() => NextResponse.next());
};
