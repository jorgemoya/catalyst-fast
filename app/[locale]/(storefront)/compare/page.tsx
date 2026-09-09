import { getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { getCompareProducts } from '~/data/compare';
import { getStoreSettings } from '~/data/settings';
import { parseCompareIds } from '~/domain/compare-selection';
import { getSelectedCurrency } from '~/lib/currency';
import { AddToCompareButton } from '~/ui/patterns/compare-controls';
import { PriceLabel } from '~/ui/patterns/price';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';
import { Rating } from '~/ui/primitives/rating';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * Product comparison table.
 *
 * `searchParams` is genuinely navigation state here — a comparison *is* its URL,
 * and it has to be shareable — so unlike the PDP's variant selection this reads
 * params on the server. The cost is bounded because the page is a leaf: nothing
 * else on it needs to be in a static shell, and the products are read through
 * one cached `'use cache: remote'` call keyed on the sorted id list.
 *
 * Gated on `productComparisonsEnabled`. A merchant who turned comparisons off
 * gets a redirect rather than a 404, matching how the gift-certificate routes
 * behave: the URL is not wrong, the feature is simply not on.
 */
/**
 * `generateMetadata` rather than a static export: the title is translated,
 * and a module-scope `t()` is evaluated once at import — pinning every
 * locale to whichever one loaded first.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  return {
  title: t('Compare.title'),
  // Never index a comparison: the id list is unbounded, so crawlers would find
  // an effectively infinite set of near-duplicate pages.
  robots: { index: false, follow: true },
  };
}

interface Props {
  searchParams: Promise<{ ids?: string | string[] }>;
}

export default async function ComparePage({ searchParams }: Props) {
  const t = await getT();

  return (
    <div className="page-container py-8">
      <h1 className="mb-6 text-2xl font-semibold">{t('Compare.title')}</h1>

      <Suspense fallback={<CompareSkeleton />}>
        <CompareTable searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function CompareTable({ searchParams }: Props) {
  const t = await getT();

  const settings = await getStoreSettings();

  if (!settings.productComparisonsEnabled) {
    redirect('/');
  }

  const ids = parseCompareIds((await searchParams).ids);

  if (ids.length === 0) {
    return <p className="text-muted">{t('Compare.empty')}</p>;
  }

  // This page already reads searchParams, so it is dynamic regardless — the
  // cookie read adds no cacheability cost here.
  const products = await getCompareProducts(
    ids,
    settings.taxDisplay.plp,
    await getSelectedCurrency(),
  );

  if (products.length === 0) {
    return <p className="text-muted">{t('Compare.notFound')}</p>;
  }

  /*
   * Custom fields are merged into one row set across every product, because a
   * comparison table is only useful when the rows line up: product A having a
   * "Material" field and product B not having one still needs a Material row,
   * with a blank cell for B.
   */
  const customFieldNames = [
    ...new Set(products.flatMap((product) => product.customFields.map((field) => field.name))),
  ];

  return (
    // The table scrolls inside its own container rather than the page: with
    // several products it is wider than any phone.
    <div className="overflow-x-auto">
      <table className="w-full min-w-3xl border-collapse text-sm">
        <caption className="sr-only">{t('Compare.title')}</caption>
        <thead>
          <tr>
            <th className="w-40 p-3 text-left align-bottom" scope="col">
              <span className="sr-only">{t('Compare.attribute')}</span>
            </th>
            {products.map((product) => (
              <th className="p-3 text-left align-bottom" key={product.id} scope="col">
                <Link className="flex flex-col gap-2" href={product.path}>
                  {product.image ? (
                    <Image
                      alt={product.image.alt}
                      className="aspect-square w-full rounded-(--radius-control) object-cover"
                      height={200}
                      src={product.image.src}
                      width={200}
                    />
                  ) : (
                    <span className="flex aspect-square w-full items-center justify-center rounded-(--radius-control) border border-border text-xs text-muted">
                      {t('Common.noImage')}
                    </span>
                  )}
                  <span className="font-medium">{product.name}</span>
                </Link>
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          <Row label={t('Compare.price')}>
            {products.map((product) => (
              <Cell key={product.id}>
                {product.price ? (
                  <PriceLabel price={product.price} />
                ) : (
                  <span className="text-muted">{t('Compare.unavailable')}</span>
                )}
              </Cell>
            ))}
          </Row>

          {settings.showProductRating ? (
            <Row label={t('Compare.rating')}>
              {products.map((product) => (
                <Cell key={product.id}>
                  {product.rating && product.rating.count > 0 ? (
                    <Rating numberOfReviews={product.rating.count} rating={product.rating.average} />
                  ) : (
                    <span className="text-muted">{t('Compare.noRating')}</span>
                  )}
                </Cell>
              ))}
            </Row>
          ) : null}

          <Row label={t('Compare.brand')}>
            {products.map((product) => (
              <Cell key={product.id}>
                {product.brand ? (
                  <Link href={product.brand.path}>{product.brand.name}</Link>
                ) : (
                  <span className="text-muted">—</span>
                )}
              </Cell>
            ))}
          </Row>

          <Row label={t('Compare.description')}>
            {products.map((product) => (
              <Cell key={product.id}>
                <p className="max-w-xs text-muted">{product.description}</p>
              </Cell>
            ))}
          </Row>

          <Row label={t('Compare.sku')}>
            {products.map((product) => (
              <Cell key={product.id}>{product.sku ?? '—'}</Cell>
            ))}
          </Row>

          <Row label={t('Compare.weight')}>
            {products.map((product) => (
              <Cell key={product.id}>
                {product.weight ? `${product.weight.value} ${product.weight.unit}` : '—'}
              </Cell>
            ))}
          </Row>

          {customFieldNames.map((name) => (
            <Row key={name} label={name}>
              {products.map((product) => (
                <Cell key={product.id}>
                  {product.customFields.find((field) => field.name === name)?.value ?? '—'}
                </Cell>
              ))}
            </Row>
          ))}

          <Row label={t('Compare.action')}>
            {products.map((product) => (
              <Cell key={product.id}>
                <AddToCompareButton
                  hasOptions={product.hasOptions}
                  inStock={product.inStock}
                  path={product.path}
                  productId={product.id}
                />
              </Cell>
            ))}
          </Row>
        </tbody>
      </table>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr className="border-t border-border">
      <th className="p-3 text-left align-top font-medium" scope="row">
        {label}
      </th>
      {children}
    </tr>
  );
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="p-3 align-top">{children}</td>;
}

function CompareSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div className="flex flex-col gap-3" key={index}>
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
