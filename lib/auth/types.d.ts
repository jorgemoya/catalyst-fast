import type { DefaultSession } from 'next-auth';

/**
 * What a signed-in session carries.
 *
 * `customerAccessToken` is a real credential, which is the reason this project
 * uses next-auth's encrypted JWT (JWE) rather than the plain signed cookie the
 * guest cart uses: a signature would leave the token readable to anything that
 * gets hold of the cookie — a log, a proxy, a browser extension. Encryption is
 * the one thing here genuinely worth not hand-rolling.
 *
 * **The cart id is deliberately absent.** It lives in the `cf.cart` cookie for
 * signed-in and guest shoppers alike; see `lib/auth/config.ts`.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      customerId: number;
      /**
       * Gates the personalized-price overlay. Customers in the default group see
       * catalog prices, so knowing the group up front means the overwhelming
       * majority of signed-in shoppers cost **zero** extra price fetches
       * (plan §3.2).
       */
      customerGroupId: number;
      customerAccessToken: string;
      firstName: string;
      lastName: string;
      /** Set when a B2B agent is acting on a customer's behalf. */
      impersonatorId: string | null;
    } & DefaultSession['user'];
  }

  interface User {
    customerId: number;
    customerGroupId: number;
    customerAccessToken: string;
    firstName: string;
    lastName: string;
    impersonatorId?: string | null;
    /** Not persisted on the session — consumed by the sign-in callback. */
    mergedCartId?: string | null;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    customerId?: number;
    customerGroupId?: number;
    customerAccessToken?: string;
    firstName?: string;
    lastName?: string;
    impersonatorId?: string | null;
  }
}

export {};
