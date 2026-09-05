import { Suspense } from 'react';

import { getFeaturedProducts, getNewestProducts } from '~/data/products';
import { Link } from '~/ui/primitives/link';
import { ProductGrid, ProductGridSkeleton } from '~/ui/patterns/product-card';
import { t } from '~/lib/i18n/messages';

/**
 * Home page.
 *
 * The page component is non-async and fetches nothing — each section is its own
 * async Server Component behind its own boundary. This is the composition rule
 * that replaces Catalyst's `Streamable` DAG: a component that needs data fetches
 * its own data, and the page owns boundary placement rather than a section
 * component owning it internally.
 *
 * Every section here reads from a `'use cache'` function with `stale: 300`, so
 * all of it lands in the prerendered shell and a warm request makes zero
 * BigCommerce calls.
 */
export default function HomePage() {
  return (
    <>
      <Hero />

      <Section
        cta={{ href: '/shop-all/', label: t('Common.shopAll') }}
        title={t('Home.featuredProducts')}
      >
        <Suspense fallback={<ProductGridSkeleton count={4} />}>
          <FeaturedProducts />
        </Suspense>
      </Section>

      <Section cta={{ href: '/shop-all/?sort=newest', label: t('Home.seeWhatsNew') }} title={t('Home.newArrivals')}>
        <Suspense fallback={<ProductGridSkeleton count={4} />}>
          <NewestProducts />
        </Suspense>
      </Section>
    </>
  );
}

function Hero() {
  return (
    <section className="page-container py-16 sm:py-24">
      <div className="max-w-2xl">
        <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          {t('Home.heroTitle')}
        </h1>
        <p className="mt-4 text-lg text-muted text-pretty">
          {t('Home.heroSubtitle')}
        </p>
        <Link
          className="mt-8 inline-flex h-11 items-center rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors duration-(--duration-fast) hover:bg-primary-hover"
          href="/shop-all/"
        >
          {t('Common.shopAll')}
        </Link>
      </div>
    </section>
  );
}

function Section({
  title,
  cta,
  children,
}: {
  title: string;
  cta?: { href: string; label: string };
  children: React.ReactNode;
}) {
  return (
    <section className="page-container py-12">
      <div className="mb-8 flex items-end justify-between gap-4">
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {cta && (
          <Link
            className="shrink-0 text-sm font-medium text-primary underline-offset-4 hover:underline"
            href={cta.href}
          >
            {cta.label}
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

async function FeaturedProducts() {
  const products = await getFeaturedProducts(8);

  if (products.length === 0) {
    return <p className="text-sm text-muted">{t('Home.noFeatured')}</p>;
  }

  // `priority` only here: this is the first grid on the page, so its first row
  // holds the LCP candidate.
  return <ProductGrid priority products={products} />;
}

async function NewestProducts() {
  const products = await getNewestProducts(8);

  if (products.length === 0) {
    return <p className="text-sm text-muted">{t('Home.noNewest')}</p>;
  }

  return <ProductGrid products={products} />;
}
