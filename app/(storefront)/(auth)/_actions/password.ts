'use server';

import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';
import { z } from 'zod';

import { getSession } from '~/data/customer/session';
import { mutate } from '~/lib/bigcommerce';
import { BigCommerceGQLError } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { t } from '~/lib/i18n/messages';

/**
 * The three password flows: request a reset, complete a reset, change while
 * signed in.
 */

const RequestResetMutation = graphql(`
  mutation RequestResetPassword($input: RequestResetPasswordInput!) {
    customer {
      requestResetPassword(input: $input) {
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

const ResetPasswordMutation = graphql(`
  mutation ResetPassword($input: ResetPasswordInput!) {
    customer {
      resetPassword(input: $input) {
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

const ChangePasswordMutation = graphql(`
  mutation ChangePassword($input: ChangePasswordInput!) {
    customer {
      changePassword(input: $input) {
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

const MIN_PASSWORD_LENGTH = 8;

const passwordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, t('Auth.passwordTooShort', { min: MIN_PASSWORD_LENGTH }));

const requestSchema = z.object({
  email: z.string().trim().min(1, t('Auth.required')).email(t('Auth.invalidEmail')),
});

const resetSchema = z
  .object({
    customerId: z.coerce.number().int().positive(),
    token: z.string().min(1),
    password: passwordField,
    confirmPassword: z.string().min(1, t('Auth.required')),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: t('Auth.passwordMismatch'),
    path: ['confirmPassword'],
  });

const changeSchema = z
  .object({
    currentPassword: z.string().min(1, t('Auth.required')),
    password: passwordField,
    confirmPassword: z.string().min(1, t('Auth.required')),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: t('Auth.passwordMismatch'),
    path: ['confirmPassword'],
  });

const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

const gqlMessage = (error: unknown, fallback: string): string => {
  if (error instanceof BigCommerceGQLError) {
    return error.errors.find((gql) => gql.message)?.message || fallback;
  }

  throw error;
};

/**
 * Request a reset link.
 *
 * **Always reports success**, whether or not the address is registered. Saying
 * "no such account" here turns the form into an oracle for which email addresses
 * exist on the store — the same reason the login form doesn't say which field
 * was wrong.
 */
export async function requestPasswordReset(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const submission = parseWithZod(formData, { schema: requestSchema });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  try {
    await mutate({
      document: RequestResetMutation,
      // `path` is where BigCommerce points the emailed link. It must match the
      // route that consumes the token below.
      variables: { input: { email: submission.value.email, path: '/reset-password' } },
    });
  } catch (error) {
    // Swallowed on purpose, for the same reason as above: a failure here must
    // not be distinguishable from success.
    console.error('[auth] requestPasswordReset', error);
  }

  return submission.reply();
}

export async function resetPassword(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const submission = parseWithZod(formData, { schema: resetSchema });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  const { customerId, token, password } = submission.value;

  try {
    const data = await mutate({
      document: ResetPasswordMutation,
      variables: {
        input: { customerEntityId: customerId, token, newPassword: password },
      },
    });

    const errors = data.customer.resetPassword.errors;

    if (errors.length > 0) {
      return submission.reply({ formErrors: [errors[0]?.message || t('Auth.resetFailed')] });
    }
  } catch (error) {
    return submission.reply({ formErrors: [gqlMessage(error, t('Auth.resetFailed'))] });
  }

  return submission.reply();
}

export async function changePassword(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const session = await getSession();

  if (!session) {
    return formError(t('Auth.notConfigured'));
  }

  const submission = parseWithZod(formData, { schema: changeSchema });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  try {
    const data = await mutate({
      document: ChangePasswordMutation,
      customerAccessToken: session.customerAccessToken,
      variables: {
        input: {
          currentPassword: submission.value.currentPassword,
          newPassword: submission.value.password,
        },
      },
    });

    const errors = data.customer.changePassword.errors;

    if (errors.length > 0) {
      return submission.reply({
        formErrors: [errors[0]?.message || t('Auth.changePasswordFailed')],
      });
    }
  } catch (error) {
    return submission.reply({ formErrors: [gqlMessage(error, t('Auth.changePasswordFailed'))] });
  }

  return submission.reply({ resetForm: true });
}
