import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getInventorySettings, getProductAvailability } from '~/data/inventory';
import { getProductPrice } from '~/data/pricing';
import { getProduct, getProductIds } from '~/data/product';
import { getStoreSettings } from '~/data/settings';
import { Breadcrumbs } from '~/ui/patterns/breadcrumbs';
import { ProductGallery, ProductGallerySkeleton } from '~/ui/patterns/product-gallery';
import { PurchaseForm } from '~/ui/patterns/purchase-form';
import { Rating } from '~/ui/primitives/rating';
import { Skeleton } from '~/ui/primitives/skeleton';

import { ProductJsonLd } from './_components/json-ld';
import { ProductReviews, ProductReviewsSkeleton } from './_components/reviews';
import { RelatedProducts, RelatedProductsSkeleton } from './_components/related-products';
import { t } from '~/lib/i18n/messages';

/**
 * Product detail page.
 *
 * The structural point of the rewrite. Catalyst's PDP built **17**
 * `Streamable.from` closures into a hand-wired dependency graph and passed the
 * promises into a single `ProductDetail` with ~43 props. Here each region is an
 * independent async Server Component behind its own `<Suspense>`, reading from a
 * cached function — and because those functions are shared rather than
 * per-component, the whole page is **5 product-scoped queries** (product,
 * prices, inventory, reviews, related), fewer than Catalyst's 7.
 *
 * The page component is not async and awaits nothing: `params` is passed down as
 * a promise and resolved at the leaves, since awaiting it here would push
 * everything below out of the static shell (Phase 0, spike 4).
 */

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * Products are the one unbounded set on a storefront, so this seeds a top-N slice
 * rather than the catalog — and defaults to none. See `getProductIds`.
 */
export async function generateStaticParams() {
  const ids = await getProductIds();

  return ids.map((id) => ({ id: String(id) }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProduct(Number((await params).id));

  if (!product) {
    return {};
  }

  const image = product.images[0];

  return {
    title: product.seo.pageTitle || product.name,
    description: product.seo.metaDescription || product.plainTextDescription,
    keywords: product.seo.metaKeywords || undefined,
    alternates: { canonical: product.path },
    openGraph: image ? { images: [{ url: image.src, alt: image.alt }] } : undefined,
  };
}

export default function ProductPage({ params }: Props) {
  return (
    <Suspense fallback={<ProductPageSkeleton />}>
      <ProductDetail params={params} />
    </Suspense>
  );
}

async function ProductDetail({ params }: Props) {
  const id = Number((await params).id);
  const product = await getProduct(id);

  if (!product) {
    notFound();
  }

  return (
    <div className="page-container py-8">
      <Breadcrumbs items={product.breadcrumbs} />

      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <ProductGallery images={product.images} productName={product.name} />

        <div className="flex flex-col gap-6">
          <div>
            {product.brand && (
              <p className="text-2xs tracking-wide text-muted uppercase">{product.brand.name}</p>
            )}
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">{product.name}</h1>
            <Suspense fallback={null}>
              <ProductRating product={product} />
            </Suspense>
          </div>

          {/*
            Price, stock, and the CTA all live inside the variant selector because
            they change together as one unit. Its initial state is resolved on the
            server from cached reads, so the shell contains the real default-variant
            price and stock rather than a placeholder.
          */}
          <Suspense fallback={<PurchaseSkeleton />}>
            <Purchase product={product} />
          </Suspense>
        </div>
      </div>

      <div className="mt-16 grid gap-12 lg:grid-cols-2">
        {product.description && (
          <section>
            <h2 className="mb-4 text-lg font-semibold">{t('Product.description')}</h2>
            <div
              className="prose-sm max-w-prose text-sm text-muted [&_a]:underline [&_p]:mb-3"
              // Merchant-authored WYSIWYG HTML.
              dangerouslySetInnerHTML={{ __html: product.description }}
            />
          </section>
        )}

        <Specifications product={product} />
      </div>

      {product.videos.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-4 text-lg font-semibold">{t('Product.videos')}</h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {product.videos.map((video) => (
              <li key={video.url}>
                <a
                  className="text-sm text-primary underline-offset-4 hover:underline"
                  href={video.url}
                  rel="noopener noreferrer"
                  target="_blank"
                >
                  {video.title}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Suspense fallback={<RelatedProductsSkeleton />}>
        <RelatedProducts productId={id} />
      </Suspense>

      <Suspense fallback={<ProductReviewsSkeleton />}>
        <ProductReviews productId={id} />
      </Suspense>

      <Suspense fallback={null}>
        <ProductJsonLd productId={id} />
      </Suspense>
    </div>
  );
}

/**
 * Star rating beside the title.
 *
 * Gated on `showProductRating`, not just on having reviews — a merchant who
 * switched rating display off should see none, and the same gap existed on the
 * PLP until Phase 2. Reviews existing is necessary but not sufficient.
 */
async function ProductRating({
  product,
}: {
  product: NonNullable<Awaited<ReturnType<typeof getProduct>>>;
}) {
  const settings = await getStoreSettings();

  if (!settings.showProductRating || product.numberOfReviews === 0) {
    return null;
  }

  return (
    <a className="mt-2 inline-block" href="#reviews">
      <Rating numberOfReviews={product.numberOfReviews} rating={product.rating} />
    </a>
  );
}

/**
 * Resolves the default variant on the server, so the shell carries real price and
 * stock. The selector then owns changes client-side.
 */
async function Purchase({ product }: { product: NonNullable<Awaited<ReturnType<typeof getProduct>>> }) {
  const [price, availability, inventory] = await Promise.all([
    getProductPrice(product.id),
    getProductAvailability(product.id),
    getInventorySettings(),
  ]);

  return (
    <PurchaseForm
      fields={product.options}
      initial={{ price, availability, inventory }}
      productId={product.id}
      quantityLimits={{ min: product.minPurchaseQuantity, max: product.maxPurchaseQuantity }}
    />
  );
}

function Specifications({ product }: { product: NonNullable<Awaited<ReturnType<typeof getProduct>>> }) {
  const rows = [
    product.sku && { name: t('Product.sku'), value: product.sku },
    product.condition && { name: t('Product.condition'), value: product.condition },
    product.weight && {
      name: t('Product.weight'),
      value: `${product.weight.value} ${product.weight.unit}`,
    },
    ...product.customFields.map((field) => ({ name: field.name, value: field.value })),
  ].filter((row): row is { name: string; value: string } => Boolean(row));

  if (rows.length === 0 && !product.warranty) {
    return null;
  }

  return (
    <section>
      {rows.length > 0 && (
        <>
          <h2 className="mb-4 text-lg font-semibold">{t('Product.specifications')}</h2>
          <dl className="divide-y divide-border border-y border-border text-sm">
            {rows.map((row) => (
              <div className="flex justify-between gap-4 py-2.5" key={`${row.name}-${row.value}`}>
                <dt className="text-muted">{row.name}</dt>
                <dd className="text-right font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}

      {product.warranty && (
        <>
          <h2 className="mt-8 mb-4 text-lg font-semibold">{t('Product.warranty')}</h2>
          <div
            className="max-w-prose text-sm text-muted"
            dangerouslySetInnerHTML={{ __html: product.warranty }}
          />
        </>
      )}
    </section>
  );
}

function PurchaseSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-12 w-full" />
    </div>
  );
}

function ProductPageSkeleton() {
  return (
    <div className="page-container py-8">
      <Skeleton className="h-4 w-64" />
      <div className="mt-6 grid gap-10 lg:grid-cols-2">
        <ProductGallerySkeleton />
        <div className="flex flex-col gap-6">
          <Skeleton className="h-9 w-3/4" />
          <PurchaseSkeleton />
        </div>
      </div>
    </div>
  );
}
