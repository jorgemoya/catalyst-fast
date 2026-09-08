'use server';

import { z } from 'zod';

import { mutate } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { t } from '~/lib/i18n/messages';

/**
 * Newsletter signup.
 *
 * Small enough not to need conform: one field, one message. The pattern is worth
 * matching to the other forms, but adding a schema factory and a `SubmissionResult`
 * round trip for a single email input would be ceremony rather than structure.
 */

const SubscribeMutation = graphql(`
  mutation SubscribeToNewsletter($input: CreateSubscriberInput!) {
    newsletter {
      subscribe(input: $input) {
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

export interface NewsletterState {
  status: 'idle' | 'success' | 'error';
  message?: string;
}

const emailSchema = z.string().trim().email();

export async function subscribeToNewsletter(
  _previous: NewsletterState | null,
  formData: FormData,
): Promise<NewsletterState> {
  const parsed = emailSchema.safeParse(formData.get('email'));

  if (!parsed.success) {
    return { status: 'error', message: t('Newsletter.invalidEmail') };
  }

  try {
    const result = await mutate({
      document: SubscribeMutation,
      variables: { input: { email: parsed.data } },
    });

    const [error] = result.newsletter.subscribe.errors;

    if (error) {
      /*
       * "Already subscribed" is reported as success.
       *
       * The shopper's intent — be on the list — is satisfied either way, and
       * telling them their address is already registered discloses, to anyone
       * who can type an email into a public form, whether that person subscribed
       * to this store. That is a small but real enumeration oracle, and the
       * honest answer costs nothing here.
       */
      if (error.__typename === 'CreateSubscriberAlreadyExistsError') {
        return { status: 'success', message: t('Newsletter.success') };
      }

      return { status: 'error', message: t('Newsletter.failed') };
    }
  } catch {
    return { status: 'error', message: t('Newsletter.failed') };
  }

  return { status: 'success', message: t('Newsletter.success') };
}
