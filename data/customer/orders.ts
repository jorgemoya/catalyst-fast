import 'server-only';

import { cacheLife, cacheTag } from 'next/cache';

import type { Pagination } from '~/domain/pagination';
import { customerQuery } from '~/lib/bigcommerce/customer';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { PaginationFragment } from '~/lib/bigcommerce/fragments/pagination';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

import { getSession } from './session';

/**
 * Order history.
 *
 * Genuinely customer-scoped — there is no shareable form of this — so it is
 * `'use cache: private'`, which never leaves the browser. The tag is per-customer
 * so a placed order invalidates one shopper's history rather than everyone's.
 */

const OrdersQuery = graphql(
  `
    query CustomerOrders($first: Int, $after: String) {
      customer {
        # CustomerOrdersSortInput is an enum, not an object: a
        # { direction, field } shape is rejected with a 400.
        orders(first: $first, after: $after, sortBy: CREATED_AT_NEWEST) {
          edges {
            node {
              entityId
              orderedAt {
                utc
              }
              status {
                label
              }
              totalIncTax {
                value
                currencyCode
              }
              consignments {
                shipping {
                  edges {
                    node {
                      lineItems {
                        edges {
                          node {
                            entityId
                            name
                            quantity
                            image {
                              url: urlTemplate(lossy: true)
                              altText
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
          pageInfo {
            ...PaginationFragment
          }
        }
      }
    }
  `,
  [PaginationFragment],
);

export interface OrderSummary {
  id: number;
  /** ISO instant — a real moment, so the UI formats it in the viewer's timezone. */
  orderedAt: string;
  status: string;
  total: { value: number; currencyCode: string };
  itemCount: number;
  /** First few product images, for a recognizable row. */
  previewImages: Array<{ src: string; alt: string }>;
}

export interface OrderHistory {
  orders: OrderSummary[];
  pagination: Pagination;
}

export const ORDERS_PAGE_SIZE = 10;

export async function getOrders(after?: string): Promise<OrderHistory | null> {
  'use cache: private';
  cacheLife({ stale: 30 });

  const session = await getSession();

  if (!session) {
    return null;
  }

  cacheTag(tags.orders(session.customerId));

  const data = await customerQuery({
    document: OrdersQuery,
    customerAccessToken: session.customerAccessToken,
    variables: { first: ORDERS_PAGE_SIZE, after: after ?? null },
  });

  const orders = data.customer?.orders;

  if (!orders) {
    return { orders: [], pagination: emptyPagination };
  }

  return {
    orders: removeEdgesAndNodes(orders).map((order) => {
      const lineItems = removeEdgesAndNodes(order.consignments?.shipping ?? { edges: [] }).flatMap(
        (consignment) => removeEdgesAndNodes(consignment.lineItems),
      );

      return {
        id: order.entityId,
        orderedAt: String(order.orderedAt.utc),
        status: order.status.label,
        total: order.totalIncTax,
        itemCount: lineItems.reduce((sum, item) => sum + item.quantity, 0),
        previewImages: lineItems
          .filter((item) => item.image)
          .slice(0, 3)
          .map((item) => ({ src: item.image?.url ?? '', alt: item.image?.altText ?? item.name })),
      };
    }),
    pagination: orders.pageInfo,
  };
}

const emptyPagination: Pagination = {
  hasNextPage: false,
  hasPreviousPage: false,
  startCursor: null,
  endCursor: null,
};

const OrderDetailQuery = graphql(`
  query CustomerOrder($entityId: Int!) {
    site {
      order(filter: { entityId: $entityId }) {
        entityId
        orderedAt {
          utc
        }
        status {
          label
        }
        subTotal {
          value
          currencyCode
        }
        shippingCostTotal {
          value
          currencyCode
        }
        taxTotal {
          value
          currencyCode
        }
        totalIncTax {
          value
          currencyCode
        }
        billingAddress {
          firstName
          lastName
          address1
          city
          stateOrProvince
          postalCode
          country
        }
        consignments {
          shipping {
            edges {
              node {
                lineItems {
                  edges {
                    node {
                      entityId
                      name
                      quantity
                      subTotalListPrice {
                        value
                        currencyCode
                      }
                      image {
                        url: urlTemplate(lossy: true)
                        altText
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`);

export interface OrderLine {
  id: number;
  name: string;
  quantity: number;
  total: { value: number; currencyCode: string };
  image: { src: string; alt: string } | null;
}

export interface OrderDetail {
  id: number;
  orderedAt: string;
  status: string;
  subtotal: { value: number; currencyCode: string };
  shipping: { value: number; currencyCode: string };
  tax: { value: number; currencyCode: string };
  total: { value: number; currencyCode: string };
  billingAddress: string[];
  lines: OrderLine[];
}

/**
 * One order.
 *
 * `site.order(filter:)` is scoped to the authenticated customer by BigCommerce,
 * so passing another shopper's order id returns null rather than their data —
 * the id in the URL is not a trust boundary.
 */
export async function getOrder(entityId: number): Promise<OrderDetail | null> {
  'use cache: private';
  cacheLife({ stale: 30 });

  const session = await getSession();

  if (!session) {
    return null;
  }

  cacheTag(tags.orders(session.customerId));

  const data = await customerQuery({
    document: OrderDetailQuery,
    customerAccessToken: session.customerAccessToken,
    variables: { entityId },
  });

  const order = data.site.order;

  if (!order) {
    return null;
  }

  const address = order.billingAddress;

  return {
    id: order.entityId,
    orderedAt: String(order.orderedAt.utc),
    status: order.status.label,
    subtotal: order.subTotal,
    shipping: order.shippingCostTotal,
    tax: order.taxTotal,
    total: order.totalIncTax,
    billingAddress: [
      `${address.firstName} ${address.lastName}`.trim(),
      address.address1,
      [address.city, address.stateOrProvince, address.postalCode].filter(Boolean).join(', '),
      address.country ?? '',
      // `filter(Boolean)` narrows at runtime but not in the type system, so the
      // predicate is spelled out — a null address line would render as "null".
    ].filter((line): line is string => Boolean(line)),
    lines: removeEdgesAndNodes(order.consignments?.shipping ?? { edges: [] })
      .flatMap((consignment) => removeEdgesAndNodes(consignment.lineItems))
      .map((item) => ({
        id: item.entityId,
        name: item.name,
        quantity: item.quantity,
        total: item.subTotalListPrice,
        image: item.image ? { src: item.image.url, alt: item.image.altText } : null,
      })),
  };
}
