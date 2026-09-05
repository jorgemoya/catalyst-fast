/**
 * Typed error hierarchy, ported verbatim from packages/client/src/{api-error,
 * gql-error,gql-auth-error,invalid-cat-error,missing-cat-error,
 * invalid-storefront-token-error,lib/error}.ts and consolidated into one file.
 *
 * This is the part of the upstream client worth keeping as-is: it distinguishes
 * HTTP-level failures from GraphQL-level ones, and auth failures from both, so
 * callers can react precisely (e.g. `customerQuery` redirects to sign-out only
 * on BigCommerceAuthError).
 */

export enum GQLErrorCode {
  INVALID_CAT = 'INVALID_CUSTOMER_ACCESS_TOKEN',
  MISSING_CAT = 'MISSING_CUSTOMER_ACCESS_TOKEN',
}

export interface GQLError {
  message: string;
  path: string[];
  locations: Array<{ line: number; column: number }>;
  extensions?: {
    [key: string]: unknown;
    code?: GQLErrorCode;
  };
}

/** Non-2xx response from the GraphQL endpoint. */
export class BigCommerceAPIError extends Error {
  constructor(
    public status: number,
    public graphqlErrors: unknown[] = [],
  ) {
    super(
      `\n    BigCommerce API returned ${status}\n    ${graphqlErrors
        .map((error) => JSON.stringify(error, null, 2))
        .join('\n')}\n    `,
    );
    this.name = 'BigCommerceAPIError';
  }

  static async createFromResponse(response: Response): Promise<BigCommerceAPIError> {
    try {
      const errorResponse: unknown = await response.json();

      assertIsErrorResponse(errorResponse);

      return new BigCommerceAPIError(response.status, errorResponse.errors);
    } catch {
      return new BigCommerceAPIError(response.status);
    }
  }
}

/**
 * A 401 where the configured storefront token isn't even JWT-shaped — almost
 * always an OAuth access token pasted into BIGCOMMERCE_STOREFRONT_TOKEN. Worth
 * its own class because the generic 401 message sends people hunting in the
 * wrong place.
 */
export class InvalidStorefrontTokenError extends BigCommerceAPIError {
  constructor(status: number, graphqlErrors: unknown[] = []) {
    super(status, graphqlErrors);

    this.name = 'InvalidStorefrontTokenError';
    this.message = [
      `BigCommerce API returned ${status}: the configured storefront token doesn't look like a JWT.`,
      '',
      'BIGCOMMERCE_STOREFRONT_TOKEN must be a storefront API JWT, not an OAuth access token.',
      'Generate one via POST /stores/{store_hash}/v3/storefront/api-token:',
      'https://developer.bigcommerce.com/docs/rest-authentication/tokens#create-a-token',
    ].join('\n');
  }
}

/** 200 response carrying a GraphQL `errors` array. */
export class BigCommerceGQLError extends Error {
  constructor(public errors: GQLError[] = []) {
    super(errors.map((error) => JSON.stringify(error, null, 2)).join('\n'));
    this.name = 'BigCommerceGQLError';
  }
}

/** Base for the two customer-access-token failure modes. */
export class BigCommerceAuthError extends BigCommerceGQLError {
  readonly code: GQLErrorCode;

  constructor(errorCode: GQLErrorCode, errors: GQLError[] = []) {
    super(errors);

    this.name = 'BigCommerceAuthError';
    this.code = errorCode;
  }
}

export class InvalidCustomerAccessTokenError extends BigCommerceAuthError {
  constructor(errors: GQLError[] = []) {
    super(GQLErrorCode.INVALID_CAT, errors);
    this.name = 'InvalidCustomerAccessTokenError';
  }
}

export class MissingCustomerAccessTokenError extends BigCommerceAuthError {
  constructor(errors: GQLError[] = []) {
    super(GQLErrorCode.MISSING_CAT, errors);
    this.name = 'MissingCustomerAccessTokenError';
  }
}

/** Maps a GraphQL `errors` array onto the most specific error class available. */
export function parseGraphQLError(result: unknown): BigCommerceGQLError {
  try {
    assertIsGQLErrorResponse(result);

    const extendedError = result.find((error) => error.extensions && 'code' in error.extensions);

    switch (extendedError?.extensions?.code) {
      case GQLErrorCode.MISSING_CAT:
        return new MissingCustomerAccessTokenError(result);

      case GQLErrorCode.INVALID_CAT:
        return new InvalidCustomerAccessTokenError(result);

      default:
        return new BigCommerceGQLError(result);
    }
  } catch {
    return new BigCommerceGQLError([{ message: 'Unknown error', path: [], locations: [] }]);
  }
}

function assertIsErrorResponse(value: unknown): asserts value is { errors: unknown[] } {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Expected an object');
  }

  if (!('errors' in value)) {
    throw new Error('Expected an errors property');
  }
}

function assertIsGQLErrorResponse(value: unknown): asserts value is GQLError[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected an array');
  }

  if (value.some((error) => typeof error !== 'object' || error === null)) {
    throw new Error('Expected an array of objects');
  }

  if (value.some((error) => !('message' in error))) {
    throw new Error('Expected every error to have a message property');
  }
}
