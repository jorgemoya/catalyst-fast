'use client';

import { useTranslations } from 'next-intl';

import { useState } from 'react';

import { loadMoreImages } from '~/app/[locale]/(storefront)/product/[id]/_actions/load-images';
import type { ProductImage } from '~/data/product';
import { cn } from '~/lib/cn';
import { Image } from '~/ui/primitives/image';

/**
 * Product gallery.
 *
 * A client island because the active-image index is local UI state — but a small
 * one: it owns an index and nothing else. Every image is rendered server-side and
 * present in the HTML, so the gallery is complete before hydration and works as a
 * scrollable strip without JS.
 *
 * Catalyst's equivalent was 327 lines inside a 43-prop section that also owned
 * pagination and a load-more server action.
 */
const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function ProductGallery({
  images: initialImages,
  productName,
  productId,
  moreCursor,
}: {
  images: ProductImage[];
  productName: string;
  productId: number;
  /** Cursor for images past the first page, or null when there are none. */
  moreCursor?: string | null;
}) {
  const t = useTranslations();

  /*
   * Seeded from the server-rendered images and only ever appended to, so the
   * gallery is complete before hydration and the button is pure enhancement.
   */
  const [images, setImages] = useState(initialImages);
  const [cursor, setCursor] = useState(moreCursor ?? null);
  const [loading, setLoading] = useState(false);

  const [activeIndex, setActiveIndex] = useState(0);
  const active = images[activeIndex] ?? images[0];

  if (!active) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-(--radius-card) bg-surface text-sm text-subtle">
        {t('Common.noImage')}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="relative aspect-square overflow-hidden rounded-(--radius-card) bg-surface">
        <Image
          alt={active.alt || productName}
          className="size-full object-cover"
          fill
          // The LCP element on a PDP. `priority` here and nowhere else on the page.
          priority
          sizes="(min-width: 1024px) 50vw, 100vw"
          src={active.src}
        />
      </div>

      {/*
        A scrollable strip rather than a carousel: no next/prev controls, because
        thumbnails are a picker and native scrolling (trackpad, touch, keyboard
        tabbing) already covers it. Selection scrolls the chosen thumbnail into
        view — see the click handler — so keyboard and programmatic selection
        never leave the active item off-screen.

        `overflow-x-auto` makes this a scroll container on *both* axes: once one
        axis is not `visible`, the other clips too. The active thumbnail's ring
        sits 4px outside the button (`ring-2` + `ring-offset-2`), so without the
        padding it gets sliced off top and bottom. The horizontal padding does the
        same for the first and last thumbnails at the scroll edges.
      */}
      {images.length > 1 && (
        <ul className="flex gap-3 overflow-x-auto px-1 py-1.5">
          {images.map((image, index) => (
            <li key={image.src}>
              <button
                aria-current={index === activeIndex}
                aria-label={t('Product.viewImage', { index: index + 1, total: images.length })}
                className={cn(
                  // `ring-offset-background` is load-bearing: Tailwind's ring
                  // offset defaults to white, which would draw a white gap around
                  // the active thumbnail in dark mode.
                  'relative block size-16 shrink-0 overflow-hidden rounded-(--radius-control) bg-surface ring-offset-2 ring-offset-background transition-shadow',
                  index === activeIndex ? 'ring-2 ring-primary' : 'hover:ring-1 hover:ring-border-strong',
                )}
                onClick={(event) => {
                  setActiveIndex(index);
                  // `nearest` on both axes so a thumbnail already in view doesn't
                  // jump, and the page never scrolls vertically to reach it.
                  //
                  // Reduced motion is checked here rather than left to CSS: the
                  // `behavior` option overrides the `scroll-behavior` rule in
                  // globals.css, so smooth scrolling would leak through to users
                  // who asked for none.
                  event.currentTarget.scrollIntoView({
                    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
                    block: 'nearest',
                    inline: 'nearest',
                  });
                }}
                type="button"
              >
                <Image
                  alt=""
                  className="size-full object-cover"
                  fill
                  sizes="64px"
                  src={image.src}
                />
              </button>
            </li>
          ))}
        </ul>
      )}

      {cursor !== null && (
        <button
          className="self-start rounded-(--radius-control) border border-border px-4 py-2 text-sm hover:bg-accent disabled:opacity-60"
          data-testid="load-more-images"
          disabled={loading}
          onClick={() => {
            setLoading(true);

            void loadMoreImages(productId, cursor)
              .then((page) => {
                // Appended, never replaced — the shopper may already have a
                // thumbnail selected, and re-seeding would move it.
                setImages((current) => [...current, ...page.images]);
                setCursor(page.nextCursor);
              })
              .catch((error: unknown) => {
                // The gallery still holds everything it had; losing the extra
                // page is not worth an error state over the product itself.
                console.error('[gallery]', error);
                setCursor(null);
              })
              .finally(() => setLoading(false));
          }}
          type="button"
        >
          {loading ? t('Product.loadingImages') : t('Product.loadMoreImages')}
        </button>
      )}
    </div>
  );
}

export function ProductGallerySkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="aspect-square animate-pulse rounded-(--radius-card) bg-surface" />
      <div className="flex gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            className="size-16 animate-pulse rounded-(--radius-control) bg-surface"
            key={index}
          />
        ))}
      </div>
    </div>
  );
}
