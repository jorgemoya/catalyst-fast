import { type DefinitionNode, type DocumentNode, type OperationDefinitionNode, parse, print } from '@0no-co/graphql.web';
import { nodeVersion, process as stdProcess, provider, runtime } from 'std-env';

import type { DocumentDecoration } from './types';

// Ported from packages/client/src/utils/*.ts.

export type Maybe<T> = T | null;

export interface Edge<T> {
  node: T;
}

export interface Connection<T> {
  edges?: Maybe<Array<Maybe<Edge<T>>>> | undefined;
}

/** Flattens BigCommerce's Relay-style `{ edges: [{ node }] }` connections. */
export const removeEdgesAndNodes = <T>(connection: Connection<T>): T[] => {
  if (!connection.edges) {
    return [];
  }

  return connection.edges.filter((edge): edge is Edge<T> => edge !== null).map((edge) => edge.node);
};

export interface OperationInfo {
  name?: string;
  type: 'query' | 'mutation' | 'subscription';
}

function isOperationDefinitionNode(node: DefinitionNode): node is OperationDefinitionNode {
   
  return node.kind === 'OperationDefinition';
}

export const getOperationInfo = (document: string): OperationInfo | undefined => {
  return parse(document)
    .definitions.filter(isOperationDefinitionNode)
    .map((definition) => ({ name: definition.name?.value, type: definition.operation }))[0];
};

export function normalizeQuery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: string | DocumentNode | DocumentDecoration<any, any>,
): string {
  if (typeof query === 'string') {
    return query;
  }

  if (query instanceof String) {
    return query.toString();
  }

  if ('kind' in query) {
    return print(query);
  }

  throw new Error('Invalid query type');
}

const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;

/**
 * Shape check only: three base64url segments whose payload decodes to JSON. This
 * does NOT verify the token is a valid storefront token — we have no signing key.
 * It only rules out tokens that aren't JWTs at all (e.g. opaque OAuth access
 * tokens), which is the failure mode it exists to catch.
 */
export function looksLikeJwt(token: string): boolean {
  const segments = token.split('.');

  if (segments.length !== 3 || !segments.every((segment) => BASE64URL_SEGMENT.test(segment))) {
    return false;
  }

  try {
    const payload = segments[1]?.replace(/-/g, '+').replace(/_/g, '/') ?? '';
    const decoded: unknown = JSON.parse(atob(payload));

    return typeof decoded === 'object' && decoded !== null;
  } catch {
    return false;
  }
}

const detectedPlatform = [runtime, provider, nodeVersion, stdProcess.env.NODE_ENV]
  .filter(Boolean)
  .join('; ');

/**
 * Builds the User-Agent sent to BigCommerce. They use this for support and
 * telemetry, so keep it accurate and keep sending it.
 */
export const getBackendUserAgent = (
  clientName: string,
  clientVersion: string,
  extensions?: string,
): string => {
  const parts = [`${clientName}/${clientVersion}`, `(${detectedPlatform})`];

  if (extensions) {
    parts.push(extensions);
  }

  return parts.join(' ');
};
