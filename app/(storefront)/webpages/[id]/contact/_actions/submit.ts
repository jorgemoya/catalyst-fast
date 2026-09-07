'use server';

import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';

import { getWebpage } from '~/data/content';
import { contactSchema, type ContactMessages, toContactSubmission } from '~/domain/contact';
import { decodeNodeId } from '~/domain/node-id';
import { mutate } from '~/lib/bigcommerce';
import { BigCommerceGQLError } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { t } from '~/lib/i18n/messages';

/**
 * Contact form submission.
 *
 * Like add-to-cart, the schema is rebuilt server-side from the page's own
 * `contactFields` rather than trusted from the submission — `getWebpage` is a
 * cached read, so it costs nothing, and it means a crafted POST cannot add
 * fields the merchant never enabled.
 *
 * reCAPTCHA is deferred to Phase 7 along with the rest of the spam-protection
 * work. Worth stating plainly rather than leaving implicit: **this endpoint is
 * currently unprotected**, and a public contact form without it will be found by
 * spammers. BigCommerce accepts an optional `reCaptchaV2` argument on this
 * mutation, so wiring it is additive.
 */

const SubmitContactUsMutation = graphql(`
  mutation SubmitContactUs($input: SubmitContactUsInput!) {
    submitContactUs(input: $input) {
      __typename
      errors {
        __typename
        ... on Error {
          message
        }
      }
    }
  }
`);

const messages: ContactMessages = {
  required: t('Contact.required'),
  invalidEmail: t('Contact.invalidEmail'),
  tooLong: (max) => t('Contact.tooLong', { max }),
};

const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

export async function submitContactForm(
  nodeId: string,
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  // Decoded for the same reason as the page: the id reaches the client through
  // the route param and comes back on submit.
  const page = await getWebpage(decodeNodeId(nodeId));

  if (!page || page.kind !== 'contact') {
    return formError(t('Contact.failed'));
  }

  const submission = parseWithZod(formData, {
    schema: contactSchema(page.contactFields, messages),
  });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  try {
    const data = await mutate({
      document: SubmitContactUsMutation,
      variables: {
        input: {
          // From the cached page, not the form: the entity id decides which
          // merchant inbox this lands in.
          pageEntityId: page.id,
          data: toContactSubmission(submission.value),
        },
      },
    });

    const errors = data.submitContactUs.errors;

    if (errors.length > 0) {
      return submission.reply({
        formErrors: [errors[0]?.message || t('Contact.failed')],
      });
    }
  } catch (error) {
    // A rejection BigCommerce words itself (a blocked address, a rate limit) is
    // worth showing; anything else is a fault and should surface as one.
    if (error instanceof BigCommerceGQLError) {
      return submission.reply({
        formErrors: [error.errors.find((gql) => gql.message)?.message || t('Contact.failed')],
      });
    }

    throw error;
  }

  return submission.reply({ resetForm: true });
}
