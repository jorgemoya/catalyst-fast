'use server';

import { getTForAction } from '~/lib/i18n/server';
import type { SubmissionResult } from '@conform-to/react';
import { z } from 'zod';

import { getSession } from '~/data/customer/session';
import { mutate } from '~/lib/bigcommerce';
import { BigCommerceGQLError } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';
import { revalidateCustomer } from '~/lib/customer/revalidate';

/**
 * Wishlist writes.
 *
 * All of them end with `revalidateCustomer`, which pairs `updateTag` with
 * `refresh()`. Both are required: the wishlist reads are `'use cache: private'`
 * and live in the browser, where `updateTag` cannot reach them.
 */

const CreateWishlistMutation = graphql(`
  mutation CreateWishlist($input: CreateWishlistInput!) {
    wishlist {
      createWishlist(input: $input) {
        result {
          entityId
        }
      }
    }
  }
`);

const UpdateWishlistMutation = graphql(`
  mutation UpdateWishlist($input: UpdateWishlistInput!) {
    wishlist {
      updateWishlist(input: $input) {
        result {
          entityId
        }
      }
    }
  }
`);

const DeleteWishlistsMutation = graphql(`
  mutation DeleteWishlists($input: DeleteWishlistsInput!) {
    wishlist {
      deleteWishlists(input: $input) {
        # Unlike every other wishlist mutation, DeleteWishlistResult.result is a
        # String, not a Wishlist — selecting subfields on it is invalid and the
        # request 400s.
        result
      }
    }
  }
`);

const AddWishlistItemsMutation = graphql(`
  mutation AddWishlistItems($input: AddWishlistItemsInput!) {
    wishlist {
      addWishlistItems(input: $input) {
        result {
          entityId
        }
      }
    }
  }
`);

const DeleteWishlistItemsMutation = graphql(`
  mutation DeleteWishlistItems($input: DeleteWishlistItemsInput!) {
    wishlist {
      deleteWishlistItems(input: $input) {
        result {
          entityId
        }
      }
    }
  }
`);

const ok: SubmissionResult = { status: 'success' };
const formError = (message: string): SubmissionResult => ({
  status: 'error',
  error: { '': [message] },
});

const id = z.coerce.number().int().positive();

async function withSession<T>(
  run: (token: string, customerId: number) => Promise<T>,
): Promise<SubmissionResult> {
  const t = await getTForAction();
  const session = await getSession();

  if (!session) {
    return formError(t('Auth.notConfigured'));
  }

  try {
    await run(session.customerAccessToken, session.customerId);
  } catch (error) {
    if (error instanceof BigCommerceGQLError) {
      return formError(error.errors.find((gql) => gql.message)?.message || t('Wishlist.saveFailed'));
    }

    throw error;
  }

  revalidateCustomer(tags.wishlists(session.customerId));

  return ok;
}

export async function createWishlist(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  const name = String(formData.get('name') ?? '').trim();

  if (!name) {
    return { status: 'error', error: { name: [t('Auth.required')] } };
  }

  return withSession(async (customerAccessToken) => {
    await mutate({
      document: CreateWishlistMutation,
      customerAccessToken,
      variables: { input: { name, isPublic: false } },
    });
  });
}

export async function renameWishlist(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  const parsed = id.safeParse(formData.get('wishlistId'));
  const name = String(formData.get('name') ?? '').trim();

  if (!parsed.success || !name) {
    return formError(t('Wishlist.saveFailed'));
  }

  return withSession(async (customerAccessToken) => {
    await mutate({
      document: UpdateWishlistMutation,
      customerAccessToken,
      variables: { input: { entityId: parsed.data, data: { name } } },
    });
  });
}

/** Toggling visibility is what makes the shareable `token` link live or dead. */
export async function setWishlistVisibility(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  const parsed = id.safeParse(formData.get('wishlistId'));
  const isPublic = formData.get('isPublic') === 'true';

  if (!parsed.success) {
    return formError(t('Wishlist.saveFailed'));
  }

  return withSession(async (customerAccessToken) => {
    await mutate({
      document: UpdateWishlistMutation,
      customerAccessToken,
      variables: { input: { entityId: parsed.data, data: { isPublic } } },
    });
  });
}

export async function deleteWishlist(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  const parsed = id.safeParse(formData.get('wishlistId'));

  if (!parsed.success) {
    return formError(t('Wishlist.saveFailed'));
  }

  return withSession(async (customerAccessToken) => {
    await mutate({
      document: DeleteWishlistsMutation,
      customerAccessToken,
      variables: { input: { entityIds: [parsed.data] } },
    });
  });
}

export async function addToWishlist(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  const wishlistId = id.safeParse(formData.get('wishlistId'));
  const productId = id.safeParse(formData.get('productId'));

  if (!wishlistId.success || !productId.success) {
    return formError(t('Wishlist.saveFailed'));
  }

  return withSession(async (customerAccessToken) => {
    await mutate({
      document: AddWishlistItemsMutation,
      customerAccessToken,
      variables: {
        input: { entityId: wishlistId.data, items: [{ productEntityId: productId.data }] },
      },
    });
  });
}

export async function removeWishlistItem(
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const t = await getTForAction();

  const wishlistId = id.safeParse(formData.get('wishlistId'));
  const itemId = id.safeParse(formData.get('itemId'));

  if (!wishlistId.success || !itemId.success) {
    return formError(t('Wishlist.saveFailed'));
  }

  return withSession(async (customerAccessToken) => {
    await mutate({
      document: DeleteWishlistItemsMutation,
      customerAccessToken,
      variables: { input: { entityId: wishlistId.data, itemEntityIds: [itemId.data] } },
    });
  });
}
