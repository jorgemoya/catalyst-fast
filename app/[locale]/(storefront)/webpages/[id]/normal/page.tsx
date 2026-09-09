import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getWebpage } from '~/data/content';
import { decodeNodeId } from '~/domain/node-id';
import { Breadcrumbs } from '~/ui/patterns/breadcrumbs';
import { Prose } from '~/ui/patterns/prose';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * A merchant's normal web page — About, Shipping, Terms.
 *
 * Reached only as a proxy rewrite target: BigCommerce resolves `/about-us/` to a
 * `NormalPage` node and `with-routes` rewrites to `/webpages/{nodeId}/normal/`.
 * `[id]` is therefore the opaque GraphQL node id, not a numeric entity id.
 *
 * No `generateStaticParams`: unlike categories, web pages have no enumerable id
 * list on the storefront API, so the route is ISR-only. That is fine here —
 * content pages are low-traffic and the `content` profile keeps them cached for a
 * week once warmed.
 */

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await getWebpage(decodeNodeId((await params).id));

  if (!page) {
    return {};
  }

  return {
    title: page.seo.pageTitle || page.name,
    description: page.seo.metaDescription || undefined,
    keywords: page.seo.metaKeywords || undefined,
    // The merchant's vanity path, never the internal rewrite target.
    alternates: { canonical: page.path },
  };
}

export default function NormalWebPage({ params }: Props) {
  return (
    <Suspense fallback={<WebPageSkeleton />}>
      <WebPageContent params={params} />
    </Suspense>
  );
}

async function WebPageContent({ params }: Props) {
  const page = await getWebpage(decodeNodeId((await params).id));

  // A ContactPage reached through the /normal/ route means the proxy and the
  // catalog disagree about this node's type — render nothing rather than a page
  // missing its form.
  if (!page || page.kind !== 'normal') {
    notFound();
  }

  return (
    <article className="page-container py-8">
      <Breadcrumbs items={page.breadcrumbs} />
      <h1 className="mt-4 text-3xl font-semibold tracking-tight">{page.name}</h1>
      {/* Sanitized in `data/content.ts`; see the contract on `Prose`. */}
      {page.body && <Prose className="mt-6" html={page.body} />}
    </article>
  );
}

function WebPageSkeleton() {
  return (
    <div className="page-container py-8">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-4 h-9 w-72" />
      <div className="mt-6 flex flex-col gap-3">
        <Skeleton className="h-4 w-full max-w-prose" />
        <Skeleton className="h-4 w-full max-w-prose" />
        <Skeleton className="h-4 w-2/3 max-w-prose" />
      </div>
    </div>
  );
}
