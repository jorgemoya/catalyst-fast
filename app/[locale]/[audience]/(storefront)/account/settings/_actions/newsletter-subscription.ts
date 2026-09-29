'use server';

import { getSession } from '~/data/customer/session';
import { getCustomerProfile } from '~/data/customer/customer';
import { mutate } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';
import { revalidateCustomer } from '~/lib/customer/revalidate';
import { getTForAction } from '~/lib/i18n/server';

/**
 * Turns the customer's newsletter subscription on or off.
 *
 * **`isSubscribedToNewsletter` was readable and unchangeable.** The field was
 * selected into the customer profile and rendered nowhere, so a shopper who
 * subscribed at signup had no way to stop — the storefront knew the answer and
 * offered no way to change it. Same read-but-never-write shape as the server
 * toast, and invisible to `dead-exports` because it is a struct field rather
 * than an export.
 *
 * **Two mutations, not one.** BigCommerce models this as subscribe/unsubscribe
 * against the newsletter list rather than a boolean on the customer, so there is
 * no `updateCustomer` field to flip. `RemoveSubscriberInput` takes only an
 * email.
 *
 * The email comes from the **session's** profile, never the form. It is the one
 * input that decides whose subscription changes, so accepting it from a
 * submission would let anyone unsubscribe anyone.
 */

const SubscribeMutation = graphql(`
  mutation SubscribeCustomerToNewsletter($input: CreateSubscriberInput!) {
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

const UnsubscribeMutation = graphql(`
  mutation UnsubscribeCustomerFromNewsletter($input: RemoveSubscriberInput!) {
    newsletter {
      unsubscribe(input: $input) {
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

export interface NewsletterToggleState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  /** Echoed back so the control reflects what actually happened. */
  subscribed?: boolean;
}

export async function setNewsletterSubscription(
  _previous: NewsletterToggleState | null,
  formData: FormData,
): Promise<NewsletterToggleState> {
  const t = await getTForAction();
  const session = await getSession();

  if (!session) {
    return { status: 'error', message: t('Account.newsletterFailed') };
  }

  const profile = await getCustomerProfile();

  if (!profile) {
    return { status: 'error', message: t('Account.newsletterFailed') };
  }

  // The checkbox is absent from the payload when unchecked, which is how HTML
  // forms represent "off" — so presence is the signal, not a parsed value.
  const subscribe = formData.get('subscribed') !== null;

  try {
    const errors = subscribe
      ? (
          await mutate({
            document: SubscribeMutation,
            variables: { input: { email: profile.email } },
          })
        ).newsletter.subscribe.errors
      : (
          await mutate({
            document: UnsubscribeMutation,
            variables: { input: { email: profile.email } },
          })
        ).newsletter.unsubscribe.errors;

    const [error] = errors;

    if (error) {
      console.error('[newsletter]', error);

      return { status: 'error', message: t('Account.newsletterFailed') };
    }
  } catch (error) {
    console.error('[newsletter]', error);

    return { status: 'error', message: t('Account.newsletterFailed') };
  }

  // The profile is a `'use cache: private'` read, so the new value only appears
  // once the customer's own scope is invalidated.
  revalidateCustomer(tags.customer(session.customerId));

  return {
    status: 'success',
    subscribed: subscribe,
    message: subscribe ? t('Account.newsletterOn') : t('Account.newsletterOff'),
  };
}
