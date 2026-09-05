import { z } from 'zod';

/**
 * Build-time snapshot of merchant settings that are stable across a deploy.
 *
 * Deliberately narrow. Anything a merchant can change at any time WITHOUT a
 * redeploy does not belong here — it would be silently wrong until the next
 * build. That data belongs in a `'use cache'` function in `data/settings.ts`
 * with a short `cacheLife` and a webhook-driven `revalidateTag`.
 *
 * Locales are excluded for the same reason (and because v1 is single-locale).
 */
export const buildConfigSchema = z.object({
  urls: z.object({
    vanityUrl: z.string(),
    cdnUrls: z.array(z.string()).default(['cdn11.bigcommerce.com']),
    checkoutUrl: z.string(),
  }),
});

export type BuildConfigSchema = z.infer<typeof buildConfigSchema>;
