'use server';

import { getTForAction } from '~/lib/i18n/server';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';

import { verifyRecaptcha } from '~/lib/recaptcha';
import { redirect } from 'next/navigation';

import { registerSchema } from '~/domain/registration';
import { isAuthConfigured, signIn } from '~/lib/auth';
import { mutate } from '~/lib/bigcommerce';
import { BigCommerceGQLError } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { getCartId } from '~/lib/cart/session';

/**
 * Create an account, then sign in.
 *
 * The sign-in is the important half. Registering without it leaves the shopper
 * authenticated nowhere — with an account they can't see and a guest cart that
 * was never merged. Signing in immediately routes them through the same
 * `guestCartEntityId` merge every other login uses.
 *
 * **reCAPTCHA guards this endpoint**, and it matters more here than on the
 * contact form: each submission creates a real customer record, so an unguarded
 * form lets a bot fill the merchant's customer list.
 *
 * Verified after schema validation, matching `submit-review.ts`: a shopper whose
 * token expired while they were filling the form still gets their field errors
 * rather than a bot-check failure that hides them. The action name is bound into
 * the token, so one minted on another form cannot be replayed here.
 */

const RegisterMutation = graphql(`
  mutation RegisterCustomer($input: RegisterCustomerInput!) {
    customer {
      registerCustomer(input: $input) {
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

const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

export async function register(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  if (!isAuthConfigured) {
    return formError(t('Auth.notConfigured'));
  }

  const submission = parseWithZod(formData, { schema: registerSchema({
    required: t('Auth.required'),
    invalidEmail: t('Auth.invalidEmail'),
    passwordTooShort: (min: number) => t('Auth.passwordTooShort', { min }),
    passwordMismatch: t('Auth.passwordMismatch'),
  }) });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  const human = await verifyRecaptcha(submission.value.recaptchaToken, 'register');

  if (!human) {
    return formError(t('Auth.botCheckFailed'));
  }

  const { email, password, firstName, lastName, company, phone } = submission.value;

  try {
    const data = await mutate({
      document: RegisterMutation,
      variables: {
        input: {
          email,
          password,
          firstName,
          lastName,
          ...(company && { company }),
          ...(phone && { phone }),
        },
      },
    });

    const errors = data.customer.registerCustomer.errors;

    if (errors.length > 0) {
      // BigCommerce words these well — "email already in use", and the store's
      // own password-complexity rules, which we cannot know up front.
      return submission.reply({ formErrors: [errors[0]?.message || t('Auth.registerFailed')] });
    }
  } catch (error) {
    if (error instanceof BigCommerceGQLError) {
      return submission.reply({
        formErrors: [error.errors.find((gql) => gql.message)?.message || t('Auth.registerFailed')],
      });
    }

    throw error;
  }

  const cartId = await getCartId();

  await signIn('password', { email, password, cartId: cartId ?? '', redirect: false });

  redirect('/account/orders');
}
