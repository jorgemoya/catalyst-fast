import { z } from 'zod';

/**
 * Review submission schema.
 *
 * Shared by the client (via `getZodConstraint`, so the form validates before it
 * ever reaches the network) and the server action, which re-validates — the
 * client-side pass is a convenience, never a trust boundary.
 */

export interface ReviewMessages {
  authorRequired: string;
  emailRequired: string;
  emailInvalid: string;
  titleRequired: string;
  titleTooLong: string;
  textRequired: string;
  textTooLong: string;
  ratingRequired: string;
}

/** BigCommerce accepts 1–5 only; anything else is rejected server-side. */
export const MIN_RATING = 1;
export const MAX_RATING = 5;

const TITLE_MAX = 255;
const TEXT_MAX = 1000;

export function reviewSchema(messages: ReviewMessages) {
  return z.object({
    /*
     * `required_error` as well as `.min(1)`.
     *
     * Conform submits an empty field as `undefined`, not `''`, so validation
     * fails at "is it present" before it ever reaches `.min(1)` — and the
     * shopper sees Zod's default "Required" instead of the copy written here.
     * Both are needed: `required_error` covers the empty submit,
     * `.min(1)` covers a field containing only whitespace after `.trim()`.
     */
    author: z
      .string({ required_error: messages.authorRequired })
      .trim()
      .min(1, messages.authorRequired)
      .max(100),

    /*
     * BigCommerce requires an email but never publishes it — it is used for
     * moderation and duplicate detection. Worth knowing when writing the form
     * copy, because shoppers reasonably assume anything they type will appear.
     */
    email: z
      .string({ required_error: messages.emailRequired })
      .trim()
      .min(1, messages.emailRequired)
      .email(messages.emailInvalid),

    title: z
      .string({ required_error: messages.titleRequired })
      .trim()
      .min(1, messages.titleRequired)
      .max(TITLE_MAX, messages.titleTooLong),

    text: z
      .string({ required_error: messages.textRequired })
      .trim()
      .min(1, messages.textRequired)
      .max(TEXT_MAX, messages.textTooLong),

    /*
     * `coerce` because a radio group submits a string. Without it every
     * submission fails with "expected number, received string" — which surfaces
     * as the rating field being mysteriously invalid no matter what is picked.
     */
    rating: z.coerce
      .number({ required_error: messages.ratingRequired, invalid_type_error: messages.ratingRequired })
      .int()
      .min(MIN_RATING, messages.ratingRequired)
      .max(MAX_RATING, messages.ratingRequired),

  });
}

export type ReviewInput = z.infer<ReturnType<typeof reviewSchema>>;
