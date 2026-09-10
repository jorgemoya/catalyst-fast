'use server';

import { getTForAction } from '~/lib/i18n/server';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';
import { z } from 'zod';

import { getFormFields } from '~/data/form-fields';
import { getSession } from '~/data/customer/session';
import {
  CUSTOM_FIELD_PREFIX,
  type CustomFormField,
  customFieldsSchema,
  toFormFieldsInput,
} from '~/domain/form-fields';
import { mutate } from '~/lib/bigcommerce';
import { BigCommerceGQLError } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';
import { revalidateCustomer } from '~/lib/customer/revalidate';

/**
 * Update the customer's own profile.
 *
 * The customer id is taken from the **session**, never from the form — this
 * mutation acts on whoever the access token belongs to, so there is no id to
 * tamper with in the first place. That is worth stating because the obvious
 * alternative (a hidden `customerId`) would be an account-takeover vector.
 */

const UpdateCustomerMutation = graphql(`
  mutation UpdateCustomer($input: UpdateCustomerInput!) {
    customer {
      updateCustomer(input: $input) {
        customer {
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

/*
 * A factory, not a constant.
 *
 * The schema carries translated validation messages, and a module-scope
 * `z.object({... t('x') ...})` is evaluated once at import — freezing whichever
 * locale happened to load first and showing English errors to a Spanish
 * shopper. Built per call instead, from the request's own translator.
 */
const profileSchema = (
  t: Awaited<ReturnType<typeof getTForAction>>,
  customFields: readonly CustomFormField[],
) =>
  z.object({
    firstName: z.string().trim().min(1, t('Auth.required')).max(50),
    lastName: z.string().trim().min(1, t('Auth.required')).max(50),
    email: z.string().trim().min(1, t('Auth.required')).email(t('Auth.invalidEmail')),
    company: z.string().trim().max(100).optional(),
    phone: z.string().trim().max(50).optional(),

    ...customFieldsSchema(customFields, {
      required: t('Auth.required'),
      tooLong: (max: number) => t('Auth.tooLong', { max }),
      invalidNumber: t('Auth.invalidNumber'),
    }),
  });

const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

export async function updateProfile(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  const session = await getSession();

  if (!session) {
    return formError(t('Auth.notConfigured'));
  }

  // The same customer field list registration uses — an account edit must be
  // able to change anything signup could set.
  const { customer: customFields } = await getFormFields();

  const submission = parseWithZod(formData, { schema: profileSchema(t, customFields) });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  try {
    const data = await mutate({
      document: UpdateCustomerMutation,
      customerAccessToken: session.customerAccessToken,
      variables: {
        input: {
          // Built-ins only; the custom values belong under `formFields`.
          ...Object.fromEntries(
            Object.entries(submission.value).filter(
              ([key]) => !key.startsWith(CUSTOM_FIELD_PREFIX),
            ),
          ),
          formFields: toFormFieldsInput(customFields, formData),
        },
      },
    });

    const errors = data.customer.updateCustomer.errors;

    if (errors.length > 0) {
      return submission.reply({ formErrors: [errors[0]?.message || t('Account.saveFailed')] });
    }
  } catch (error) {
    // A rejection BigCommerce words itself — an email already in use, a
    // validation rule — is worth showing verbatim; anything else is a fault.
    if (error instanceof BigCommerceGQLError) {
      return submission.reply({
        formErrors: [error.errors.find((gql) => gql.message)?.message || t('Account.saveFailed')],
      });
    }

    throw error;
  }

  revalidateCustomer(tags.customer(session.customerId));

  return submission.reply();
}
