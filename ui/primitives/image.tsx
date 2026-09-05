'use client';

import NextImage, { type ImageProps } from 'next/image';

import { buildConfig } from '~/lib/config';
import bcCdnImageLoader from '~/lib/image-loader';

const cdnUrls = buildConfig.get('urls').cdnUrls;

function shouldUseBcLoader(src: ImageProps['src']): boolean {
  if (typeof src !== 'string') {
    return false;
  }

  return cdnUrls.some((cdn) => src.startsWith(`https://${cdn}`));
}

/**
 * `next/image` with BigCommerce CDN awareness.
 *
 * Callers should keep threading `priority` on the LCP image (the PDP hero, the
 * first row of a PLP grid) and `sizes` everywhere else — that pairing is what
 * makes the CDN loader pay off, since without `sizes` the browser requests a
 * width far larger than it needs.
 */
export function Image({ alt, ...props }: ImageProps) {
  return (
    <NextImage
      alt={alt}
      loader={shouldUseBcLoader(props.src) ? bcCdnImageLoader : undefined}
      {...props}
    />
  );
}
