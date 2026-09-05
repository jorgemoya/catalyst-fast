'use client';

import type { ImageLoaderProps } from 'next/image';

/**
 * BigCommerce CDN image loader. BC embeds a literal `{:size}` token in its image
 * URLs and does the resizing and format negotiation itself, so substituting the
 * requested width is the entire job.
 *
 * The win is skipping Next's image optimizer for product imagery: no
 * fetch-then-transform hop per unique size, no optimizer cold starts, and CDN
 * cache hits shared across every deploy. Non-BC images (YouTube posters, etc.)
 * fall through to the default loader — see `shouldUseBcLoader` in
 * ui/primitives/image.tsx.
 *
 * Ported from core/lib/cdn-image-loader.ts.
 */
export default function bcCdnImageLoader({ src, width }: ImageLoaderProps): string {
  return src.replace('{:size}', `${width}w`);
}
