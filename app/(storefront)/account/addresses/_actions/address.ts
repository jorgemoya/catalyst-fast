'use server';

import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';

import { getSession } from '~/data/customer/session';
import { addressSchema } from '~/domain/address';
import { mutate } from '~/lib/bigcommerce';
import { BigCommerceGQLError } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';
import { revalidateCustomer } from '~/lib/customer/revalidate';
import { t } from '~/lib/i18n/messages';

/**
 * Address book writes.
 *
 * Like the profile action, these act on whoever the access token belongs to —
 * BigCommerce scopes `addCustomerAddress` and friends to the authenticated
 * customer, so there is no customer id in the payload to tamper with. The
 * *address* id is in the form, but BigCommerce rejects an id belonging to
 * someone else, which is the guard that matters.
 */

const AddAddressMutation = graphql(`
  mutation AddCustomerAddress($input: AddCustomerAddressInput!) {
    customer {
      addCustomerAddress(input: $input) {
        address {
          entityId
        }
        errors {
          __typename
          ... on Error {
            message
          }
        }
      }
    }
  }
`);

const UpdateAddressMutation = graphql(`
  mutation UpdateCustomerAddress($input: UpdateCustomerAddressInput!) {
    customer {
      updateCustomerAddress(input: $input) {
        address {
          entityId
        }
        errors {
          __typename
          ... on Error {
            message
          }
        }
      }
    }
  }
`);

const DeleteAddressMutation = graphql(`
  mutation DeleteCustomerAddress($input: DeleteCustomerAddressInput!) {
    customer {
      deleteCustomerAddress(input: $input) {
        errors {
          __typename
          ... on Error {
            message
          }
        }
      }
    }
  }
`);

const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

const surface = (error: unknown, fallback: string): string => {
  if (error instanceof BigCommerceGQLError) {
    return error.errors.find((gql) => gql.message)?.message || fallback;
  }

  throw error;
};

export async function saveAddress(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const session = await getSession();

  if (!session) {
    return formError(t('Auth.notConfigured'));
  }

  const submission = parseWithZod(formData, { schema: addressSchema });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  const { addressEntityId, ...data } = submission.value;

  try {
    // One form serves both create and edit; the presence of an id decides which
    // mutation runs, so there is a single schema and a single set of validation
    // messages rather than two that can drift.
    const errors = addressEntityId
      ? (
          await mutate({
            document: UpdateAddressMutation,
            customerAccessToken: session.customerAccessToken,
            variables: { input: { addressEntityId, data } },
          })
        ).customer.updateCustomerAddress.errors
      : (
          await mutate({
            document: AddAddressMutation,
            customerAccessToken: session.customerAccessToken,
            variables: { input: data },
          })
        ).customer.addCustomerAddress.errors;

    if (errors.length > 0) {
      return submission.reply({ formErrors: [errors[0]?.message || t('Account.addressFailed')] });
    }
  } catch (error) {
    return submission.reply({ formErrors: [surface(error, t('Account.addressFailed'))] });
  }

  revalidateCustomer(tags.customer(session.customerId));

  return submission.reply({ resetForm: !addressEntityId });
}

export async function deleteAddress(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const session = await getSession();

  if (!session) {
    return formError(t('Auth.notConfigured'));
  }

  const addressEntityId = Number(formData.get('addressEntityId'));

  if (!Number.isInteger(addressEntityId) || addressEntityId <= 0) {
    return formError(t('Account.addressFailed'));
  }

  try {
    const data = await mutate({
      document: DeleteAddressMutation,
      customerAccessToken: session.customerAccessToken,
      variables: { input: { addressEntityId } },
    });

    const errors = data.customer.deleteCustomerAddress.errors;

    if (errors.length > 0) {
      return formError(errors[0]?.message || t('Account.addressFailed'));
    }
  } catch (error) {
    return formError(surface(error, t('Account.addressFailed')));
  }

  revalidateCustomer(tags.customer(session.customerId));

  return { status: 'success' };
}
