import { getT } from '~/lib/i18n/server';
import { Suspense } from 'react';

import { getFeaturedProducts, getNewestProducts } from '~/data/products';
import { getStoreSettings } from '~/data/settings';
import { getDefaultCurrency, getSelectedCurrency } from '~/lib/currency';
import { Link } from '~/ui/primitives/link';
import { ProductGrid, ProductGridSkeleton } from '~/ui/patterns/product-card';
import { NewsletterForm } from '~/ui/patterns/newsletter-form';

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
export default async function HomePage() {
  const t = await getT();

  return (
    <>
      <Hero />

      <Section
        cta={{ href: '/shop-all/', label: t('Common.shopAll') }}
        title={t('Home.featuredProducts')}
      >
        {/* Cached default-currency grid in the shell, the shopper's currency
            streamed over it. Inner boundary because a fallback must not itself
            suspend — the Phase 0 spike. */}
        <Suspense
          fallback={
            <Suspense fallback={<ProductGridSkeleton count={4} />}>
              <FeaturedProducts />
            </Suspense>
          }
        >
          <FeaturedProductsSelected />
        </Suspense>
      </Section>

      <Section cta={{ href: '/shop-all/?sort=newest', label: t('Home.seeWhatsNew') }} title={t('Home.newArrivals')}>
        <Suspense
          fallback={
            <Suspense fallback={<ProductGridSkeleton count={4} />}>
              <NewestProducts />
            </Suspense>
          }
        >
          <NewestProductsSelected />
        </Suspense>
      </Section>

      {/* Setting-gated, and in its own boundary so the signup never delays the
          product grids above it. */}
      <Suspense fallback={null}>
        <Newsletter />
      </Suspense>
    </>
  );
}

/**
 * Newsletter signup, shown only when the merchant has it enabled.
 *
 * Reads the same cached settings entry the rest of the page already uses, so the
 * gate costs no additional origin request.
 */
async function Newsletter() {
  const t = await getT();

  const { newsletterEnabled } = await getStoreSettings();

  if (!newsletterEnabled) {
    return null;
  }

  return (
    <section className="page-container border-t border-border py-12">
      <h2 className="text-lg font-semibold">{t('Newsletter.title')}</h2>
      <p className="mt-2 mb-4 max-w-prose text-sm text-muted">{t('Newsletter.description')}</p>
      <NewsletterForm />
    </section>
  );
}

async function Hero() {
  const t = await getT();

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

/**
 * The cached, default-currency grid. No cookie read, so it prerenders and lands
 * in the static shell — which is what keeps the home page free for the
 * overwhelming majority who never touch the currency switcher.
 */
async function FeaturedProducts() {
  const t = await getT();

  const products = await getFeaturedProducts(await getDefaultCurrency(), 8);

  if (products.length === 0) {
    return <p className="text-sm text-muted">{t('Home.noFeatured')}</p>;
  }

  // `priority` only here: this is the first grid on the page, so its first row
  // holds the LCP candidate.
  return <ProductGrid priority products={products} />;
}

/** The shopper's currency. A hole, streamed over the cached grid above. */
async function FeaturedProductsSelected() {
  const t = await getT();

  const products = await getFeaturedProducts(await getSelectedCurrency(), 8);

  if (products.length === 0) {
    return <p className="text-sm text-muted">{t('Home.noFeatured')}</p>;
  }

  return <ProductGrid priority products={products} />;
}

async function NewestProductsSelected() {
  const t = await getT();

  const products = await getNewestProducts(await getSelectedCurrency(), 8);

  if (products.length === 0) {
    return <p className="text-sm text-muted">{t('Home.noNewest')}</p>;
  }

  return <ProductGrid products={products} />;
}

async function NewestProducts() {
  const t = await getT();

  const products = await getNewestProducts(await getDefaultCurrency(), 8);

  if (products.length === 0) {
    return <p className="text-sm text-muted">{t('Home.noNewest')}</p>;
  }

  return <ProductGrid products={products} />;
}
