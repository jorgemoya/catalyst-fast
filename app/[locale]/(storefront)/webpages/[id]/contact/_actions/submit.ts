'use server';

import { getTForAction } from '~/lib/i18n/server';
import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';

import { readRecaptchaToken } from '~/lib/recaptcha';

import { getWebpage } from '~/data/content';
import { contactSchema, type ContactMessages, toContactSubmission } from '~/domain/contact';
import { decodeNodeId } from '~/domain/node-id';
import { mutate } from '~/lib/bigcommerce';
import { BigCommerceGQLError } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';

/**
 * Contact form submission.
 *
 * Like add-to-cart, the schema is rebuilt server-side from the page's own
 * `contactFields` rather than trusted from the submission — `getWebpage` is a
 * cached read, so it costs nothing, and it means a crafted POST cannot add
 * fields the merchant never enabled.
 *
 * **reCAPTCHA guards this endpoint.** A public contact form without it will be
 * found by spammers; that is not a prediction, it is what happens to every
 * unguarded contact form on the internet.
 *
 * Verified after schema validation, matching `submit-review.ts`, so a stale
 * token does not mask the shopper's field errors.
 */

const SubmitContactUsMutation = graphql(`
  mutation SubmitContactUs($input: SubmitContactUsInput!, $reCaptchaV2: ReCaptchaV2Input) {
    submitContactUs(input: $input, reCaptchaV2: $reCaptchaV2) {
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

/** Built per request: these strings are translated. */
const contactMessages = (t: Awaited<ReturnType<typeof getTForAction>>): ContactMessages => ({
  required: t('Contact.required'),
  invalidEmail: t('Contact.invalidEmail'),
  tooLong: (max) => t('Contact.tooLong', { max }),
});

const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

export async function submitContactForm(
  nodeId: string,
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  // Decoded for the same reason as the page: the id reaches the client through
  // the route param and comes back on submit.
  const page = await getWebpage(decodeNodeId(nodeId));

  if (!page || page.kind !== 'contact') {
    return formError(t('Contact.failed'));
  }

  const submission = parseWithZod(formData, {
    schema: contactSchema(page.contactFields, contactMessages(t)),
  });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  const recaptcha = await readRecaptchaToken(formData);

  if (!recaptcha.ok) {
    return formError(t('Contact.botCheckFailed'));
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
        /*
         * Forwarded, not verified here: BigCommerce holds the secret and
         * validates the token itself. `undefined` when the store has reCAPTCHA
         * off — the argument is optional and an empty token is rejected.
         */
        reCaptchaV2: recaptcha.reCaptchaV2,
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
