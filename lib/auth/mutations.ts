import 'server-only';

import { mutate } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';

/**
 * The three BigCommerce mutations that move a shopper between anonymous and
 * signed-in.
 *
 * **`guestCartEntityId` is the cart merge.** BigCommerce reassigns the guest cart
 * to the customer and returns the resulting cart — merging it with any cart the
 * customer already had. There is no client-side merge to write, which is why
 * Phase 4's decision to keep the cart id in its own cookie costs nothing here:
 * login hands BigCommerce the old id and writes back the new one.
 */

const LoginMutation = graphql(`
  mutation Login($email: String!, $password: String!, $cartEntityId: String) {
    login(email: $email, password: $password, guestCartEntityId: $cartEntityId) {
      customerAccessToken {
        value
      }
      customer {
        entityId
        customerGroupId
        firstName
        lastName
        email
      }
      cart {
        entityId
      }
    }
  }
`);

const LoginWithJwtMutation = graphql(`
  mutation LoginWithCustomerLoginJwt($jwt: String!, $cartEntityId: String) {
    loginWithCustomerLoginJwt(jwt: $jwt, guestCartEntityId: $cartEntityId) {
      customerAccessToken {
        value
      }
      customer {
        entityId
        customerGroupId
        firstName
        lastName
        email
      }
      cart {
        entityId
      }
    }
  }
`);

const LogoutMutation = graphql(`
  mutation Logout($cartEntityId: String) {
    logout(cartEntityId: $cartEntityId) {
      result
      cartUnassignResult {
        cart {
          entityId
        }
      }
    }
  }
`);

export interface AuthenticatedCustomer {
  customerId: number;
  customerGroupId: number;
  customerAccessToken: string;
  firstName: string;
  lastName: string;
  email: string;
  /** The cart BigCommerce ended up with after merging the guest cart, if any. */
  mergedCartId: string | null;
}

const toCustomer = (
  result: {
    customerAccessToken: { value: string } | null;
    customer: {
      entityId: number;
      customerGroupId: number;
      firstName: string;
      lastName: string;
      email: string;
    } | null;
    cart: { entityId: string } | null;
  },
  impersonatorId?: string | null,
): (AuthenticatedCustomer & { impersonatorId?: string | null }) | null => {
  if (!result.customerAccessToken || !result.customer) {
    return null;
  }

  return {
    customerId: result.customer.entityId,
    customerGroupId: result.customer.customerGroupId,
    customerAccessToken: result.customerAccessToken.value,
    firstName: result.customer.firstName,
    lastName: result.customer.lastName,
    email: result.customer.email,
    mergedCartId: result.cart?.entityId ?? null,
    ...(impersonatorId !== undefined && { impersonatorId }),
  };
};

export async function loginWithPassword(
  email: string,
  password: string,
  guestCartId?: string,
): Promise<AuthenticatedCustomer | null> {
  const data = await mutate({
    document: LoginMutation,
    variables: { email, password, cartEntityId: guestCartId ?? null },
  });

  return toCustomer(data.login);
}

export async function loginWithJwt(
  jwt: string,
  guestCartId: string | undefined,
  impersonatorId: string | null,
): Promise<(AuthenticatedCustomer & { impersonatorId?: string | null }) | null> {
  const data = await mutate({
    document: LoginWithJwtMutation,
    variables: { jwt, cartEntityId: guestCartId ?? null },
  });

  return toCustomer(data.loginWithCustomerLoginJwt, impersonatorId);
}

/**
 * Ends the BigCommerce session and, when persistent cart is off, hands the cart
 * back as an anonymous one so signing out doesn't silently empty it.
 *
 * Returns the unassigned cart id, or null when BigCommerce kept the cart with the
 * customer.
 */
export async function logoutCustomer(
  customerAccessToken: string,
  cartId?: string,
): Promise<string | null> {
  const data = await mutate({
    document: LogoutMutation,
    variables: { cartEntityId: cartId ?? null },
    customerAccessToken,
  });

  return data.logout.cartUnassignResult.cart?.entityId ?? null;
}
