import 'server-only';

import { mutate, query } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';

/**
 * Shipping cost estimation from the cart.
 *
 * BigCommerce has no "quote shipping for this address" call. The only way to get
 * rates is to attach a **shipping consignment** to the checkout — the checkout
 * shares its id with the cart — and then read the options it comes back with.
 * So estimating is a write, which is why this lives in `lib/cart/` beside the
 * other mutations rather than in `data/`, and why it is never cached: the
 * quote depends on cart contents that change underneath it.
 *
 * The consignment is deleted when the shopper edits or cancels, so a stale
 * consignment cannot follow them into the real checkout and silently preselect
 * a shipping method they never chose.
 */

const CheckoutLineItemsQuery = graphql(`
  query CheckoutLineItems($cartId: String!) {
    site {
      checkout(entityId: $cartId) {
        entityId
        shippingConsignments {
          entityId
        }
        cart {
          lineItems {
            physicalItems {
              entityId
              quantity
            }
          }
        }
      }
    }
  }
`);

const AddShippingConsignmentsMutation = graphql(`
  mutation AddCheckoutShippingConsignments($input: AddCheckoutShippingConsignmentsInput!) {
    checkout {
      addCheckoutShippingConsignments(input: $input) {
        checkout {
          shippingConsignments {
            entityId
            availableShippingOptions {
              entityId
              description
              cost {
                value
                currencyCode
              }
            }
          }
        }
      }
    }
  }
`);

const DeleteConsignmentMutation = graphql(`
  mutation DeleteCheckoutConsignment($input: DeleteCheckoutConsignmentInput!) {
    checkout {
      deleteCheckoutConsignment(input: $input) {
        checkout {
          entityId
        }
      }
    }
  }
`);

export interface ShippingOption {
  id: string;
  description: string;
  cost: { value: number; currencyCode: string };
  /**
   * The consignment this option belongs to.
   *
   * Carried on every option because selecting one requires it, and the estimate
   * response is the only place it is available. It used to be flattened away,
   * which is why the shopper could see quotes and not choose between them —
   * `selectCheckoutShippingOption` needs both ids and we had thrown one out.
   */
  consignmentId: string;
}

export interface ShippingAddress {
  countryCode: string;
  /** BigCommerce matches on the code where one exists, the name otherwise. */
  stateOrProvince?: string;
  stateOrProvinceCode?: string;
  city?: string;
  postalCode?: string;
}

/**
 * Quotes shipping for an address.
 *
 * Returns an empty array when nothing ships there — a real and common outcome
 * that the UI must distinguish from an error, because "we don't ship to Alaska"
 * and "something went wrong" call for completely different shopper responses.
 */
export async function estimateShipping(
  cartId: string,
  address: ShippingAddress,
): Promise<ShippingOption[]> {
  const checkoutData = await query({
    document: CheckoutLineItemsQuery,
    variables: { cartId },
  });

  const checkout = checkoutData.site.checkout;

  if (!checkout) {
    return [];
  }

  /*
   * Only physical items can be shipped. A cart of digital products or gift
   * certificates has no consignment to create, and sending an empty line-item
   * list makes BigCommerce reject the mutation outright.
   */
  const lineItems = checkout.cart?.lineItems.physicalItems.map((item) => ({
    lineItemEntityId: item.entityId,
    quantity: item.quantity,
  }));

  if (!lineItems || lineItems.length === 0) {
    return [];
  }

  // Estimating twice would otherwise stack consignments and split the cart
  // across several shipments.
  await clearShippingConsignments(cartId, checkout.shippingConsignments?.map((c) => c.entityId));

  const result = await mutate({
    document: AddShippingConsignmentsMutation,
    variables: {
      input: {
        checkoutEntityId: cartId,
        data: {
          consignments: [
            {
              // `shouldSaveAddress: false` is required by the input type and is
              // also correct here: an estimate is not the shopper choosing a
              // delivery address, and saving it would put a half-entered address
              // in their address book.
              address: { ...address, shouldSaveAddress: false },
              lineItems,
            },
          ],
        },
      },
    },
  });

  const consignments = result.checkout.addCheckoutShippingConsignments?.checkout
    ?.shippingConsignments;

  return (consignments ?? []).flatMap((consignment) =>
    (consignment.availableShippingOptions ?? []).map((option) => ({
      consignmentId: consignment.entityId,
      id: option.entityId,
      description: option.description,
      cost: option.cost,
    })),
  );
}

/**
 * Removes estimate consignments.
 *
 * Called before every estimate and when the shopper cancels. Failures are
 * swallowed: this is cleanup, and letting it throw would turn a successful
 * re-estimate into an error the shopper cannot act on.
 *
 * `consignmentIds` is optional so a caller that has just fetched the checkout
 * can pass what it already knows. **Omitting it means "look them up"**, not
 * "there are none" — an earlier version returned early on an empty argument,
 * which made the cancel button silently do nothing and leave the consignment
 * attached to the checkout.
 */
export async function clearShippingConsignments(
  cartId: string,
  consignmentIds?: string[],
): Promise<void> {
  let ids = consignmentIds;

  if (!ids) {
    try {
      const data = await query({ document: CheckoutLineItemsQuery, variables: { cartId } });

      ids = data.site.checkout?.shippingConsignments?.map((c) => c.entityId) ?? [];
    } catch {
      return;
    }
  }

  if (ids.length === 0) {
    return;
  }

  await Promise.all(
    ids.map(async (consignmentEntityId) => {
      try {
        await mutate({
          document: DeleteConsignmentMutation,
          variables: { input: { checkoutEntityId: cartId, consignmentEntityId } },
        });
      } catch {
        // Best effort.
      }
    }),
  );
}

const SelectShippingOptionMutation = graphql(`
  mutation SelectCheckoutShippingOption($input: SelectCheckoutShippingOptionInput!) {
    checkout {
      selectCheckoutShippingOption(input: $input) {
        checkout {
          entityId
          shippingCostTotal {
            value
            currencyCode
          }
        }
      }
    }
  }
`);

/**
 * Applies the shopper's chosen shipping method to the checkout.
 *
 * **The half of the estimator that was missing.** Quotes were fetched and
 * rendered as a read-only list, so a shopper could see that Express costs $18
 * and had no way to pick it — the consignment kept whatever BigCommerce had
 * defaulted to. Catalyst calls the same mutation from `add-shipping-cost.ts`.
 *
 * Returns the resulting shipping total so the summary can show what was applied
 * rather than re-fetching the cart to find out.
 */
export async function selectShippingOption(
  cartId: string,
  consignmentId: string,
  shippingOptionId: string,
): Promise<{ value: number; currencyCode: string } | null> {
  const result = await mutate({
    document: SelectShippingOptionMutation,
    variables: {
      input: {
        checkoutEntityId: cartId,
        consignmentEntityId: consignmentId,
        data: { shippingOptionEntityId: shippingOptionId },
      },
    },
  });

  return result.checkout.selectCheckoutShippingOption?.checkout?.shippingCostTotal ?? null;
}
