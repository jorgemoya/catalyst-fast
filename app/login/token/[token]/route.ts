import { decodeJwt } from 'jose';
import { type NextRequest, NextResponse } from 'next/server';

import { safeRedirectPath } from '~/domain/redirect';
import { signIn } from '~/lib/auth';
import { getCartId } from '~/lib/cart/session';

/**
 * Customer Login API handoff — SSO from an external identity provider, and B2B
 * agent impersonation.
 *
 * A GET, because BigCommerce and third-party IdPs redirect the browser here. That
 * makes the token itself the credential, so it must be single-use and
 * short-lived on BigCommerce's side; nothing here can make a replayed token safe.
 *
 * Outside the `(storefront)` group: there is no chrome to render, only a
 * redirect. Under `/login/token/` rather than `/api/` so it reads as a
 * user-facing entry point in logs and analytics.
 *
 * `redirect_to` is a claim *inside the signed token*, so unlike the login form's
 * query parameter it cannot be tampered with — but it is still run through
 * `safeRedirectPath`, because a compromised or misconfigured IdP is exactly the
 * case where an absolute URL would be most damaging.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  const noStore = { 'Cache-Control': 'no-store, must-revalidate' };
  const failure = NextResponse.redirect(new URL('/login?error=InvalidToken', request.url), {
    status: 302,
    headers: noStore,
  });

  if (!token) {
    return failure;
  }

  let redirectTo = '/account/orders';

  try {
    const claims = decodeJwt(token);

    redirectTo = safeRedirectPath(claims.redirect_to?.toString(), '/account/orders');
  } catch {
    // An undecodable token is not worth handing to BigCommerce.
    return failure;
  }

  const cartId = await getCartId();
  const result = await signIn('jwt', { jwt: token, cartId: cartId ?? '', redirect: false });

  if (!result || (typeof result === 'object' && 'error' in result && result.error)) {
    return failure;
  }

  return NextResponse.redirect(new URL(redirectTo, request.url), {
    status: 302,
    headers: noStore,
  });
}
