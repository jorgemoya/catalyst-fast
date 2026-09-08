'use server';

import type { SubmissionResult } from '@conform-to/react';
import { parseWithZod } from '@conform-to/zod';
import { updateTag } from 'next/cache';

import { reviewSchema } from '~/domain/review';
import { mutate } from '~/lib/bigcommerce';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';
import { t } from '~/lib/i18n/messages';
import { verifyRecaptcha } from '~/lib/recaptcha';

/**
 * Review submission.
 *
 * BigCommerce moderates reviews, so a successful submission does **not** mean
 * the review appears — it means it is queued. The success copy says exactly
 * that, because a shopper who submits a review and cannot find it will otherwise
 * submit it again.
 *
 * The whole `AddProductReviewError` union is mapped rather than collapsed into a
 * generic failure: "you have already reviewed this product" and "reviews are not
 * enabled" are both actionable, and both are indistinguishable from a bug if the
 * form just says "something went wrong".
 */

const AddProductReviewMutation = graphql(`
  mutation AddProductReview($input: AddProductReviewInput!) {
    catalog {
      addProductReview(input: $input) {
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

/**
 * Maps BigCommerce's error union to copy from the message catalogue.
 *
 * `InvalidInputFieldsError` keeps BigCommerce's own message: it names the field
 * that was rejected, which is information the generic string cannot carry. The
 * others get translatable copy, because BigCommerce's wording adds nothing a
 * shopper can act on. This mirrors the split documented in
 * `lib/cart/error-message.ts`.
 */
function toErrorMessage(error: { __typename: string; message?: string }): string {
  switch (error.__typename) {
    case 'CustomerAlreadyReviewedProductError':
      return t('Product.reviewAlreadySubmitted');

    case 'NotAuthorizedToAddProductReviewError':
      return t('Product.reviewNotAllowed');

    case 'ProductIdNotFoundError':
      return t('Product.reviewProductMissing');

    case 'InvalidInputFieldsError':
      return error.message ?? t('Product.reviewFailed');

    default:
      return t('Product.reviewFailed');
  }
}

export async function submitReview(
  productId: number,
  _previous: SubmissionResult | null,
  formData: FormData,
): Promise<SubmissionResult> {
  const submission = parseWithZod(formData, {
    schema: reviewSchema({
      authorRequired: t('Product.reviewAuthorRequired'),
      emailRequired: t('Product.reviewEmailRequired'),
      emailInvalid: t('Product.reviewEmailInvalid'),
      titleRequired: t('Product.reviewTitleRequired'),
      titleTooLong: t('Product.reviewTitleTooLong'),
      textRequired: t('Product.reviewTextRequired'),
      textTooLong: t('Product.reviewTextTooLong'),
      ratingRequired: t('Product.reviewRatingRequired'),
    }),
  });

  if (submission.status !== 'success') {
    return submission.reply();
  }

  /*
   * Checked after schema validation so a shopper with a stale token still gets
   * their field errors, rather than a bot-check failure that hides them. The
   * action name is bound into the token, so a token minted on a different form
   * cannot be replayed here.
   */
  const human = await verifyRecaptcha(submission.value.recaptchaToken, 'submit_review');

  if (!human) {
    return formError(t('Product.reviewBotCheckFailed'));
  }

  const { author, email, title, text, rating } = submission.value;

  try {
    const result = await mutate({
      document: AddProductReviewMutation,
      variables: {
        input: {
          productEntityId: productId,
          review: { author, email, title, text, rating },
        },
      },
    });

    const errors = result.catalog.addProductReview.errors;

    if (errors.length > 0) {
      return formError(toErrorMessage(errors[0] as { __typename: string; message?: string }));
    }
  } catch {
    return formError(t('Product.reviewFailed'));
  }

  /*
   * Invalidates the cached review list even though a moderated review will not
   * appear yet. Cheap, and it means a store with moderation switched off shows
   * the review immediately rather than up to an hour later.
   */
  updateTag(tags.productReviews(productId));

  return { status: 'success' };
}
