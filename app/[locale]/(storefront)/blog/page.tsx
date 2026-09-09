import { getFormatDate, getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getBlogPosts } from '~/data/content';
import { isSinglePage } from '~/domain/pagination';
import { Breadcrumbs } from '~/ui/patterns/breadcrumbs';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * Blog index.
 *
 * `?tag=` and `?after=` are read at the leaf rather than in the page component,
 * so the unfiltered first page stays prerenderable while a tag-filtered view
 * streams in. Tags are a bounded merchant-defined set, so each gets its own
 * long-lived `content` entry instead of fragmenting the cache the way arbitrary
 * query strings would.
 */

interface Props {
  searchParams: Promise<{ tag?: string; after?: string }>;
}

/**
 * Canonical always points at the blog root, including on `?tag=` views.
 *
 * A tag view is a filtered slice of the same posts — thin, duplicated content
 * with no independent value to index. Pointing it at itself would ask a crawler
 * to index one page per tag; pointing it at the root consolidates the signal.
 */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();

  const blog = await getBlogPosts();

  return {
    title: blog?.name || t('Blog.title'),
    description: blog?.description || undefined,
    ...(blog && { alternates: { canonical: blog.path } }),
  };
}

export default function BlogPage({ searchParams }: Props) {
  return (
    <div className="page-container py-8">
      <Suspense fallback={<BlogSkeleton />}>
        <BlogIndexContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function BlogIndexContent({ searchParams }: Props) {
  const t = await getT();
  const formatDate = await getFormatDate();

  const { tag, after } = await searchParams;
  const blog = await getBlogPosts(tag, after);

  if (!blog) {
    notFound();
  }

  const crumbs = [{ label: blog.name, href: blog.path }];

  return (
    <>
      {/* A tag filter adds a crumb, so the shopper can get back to the full list. */}
      <Breadcrumbs items={tag ? [...crumbs, { label: tag, href: `/blog?tag=${tag}` }] : crumbs} />

      <header className="mt-4 mb-8">
        <h1 className="text-3xl font-semibold tracking-tight">{blog.name}</h1>
        {blog.description && <p className="mt-3 max-w-prose text-sm text-muted">{blog.description}</p>}
      </header>

      {blog.posts.length === 0 ? (
        <div className="rounded-(--radius-card) border border-border py-16 text-center">
          <h2 className="text-lg font-semibold">{t('Blog.emptyTitle')}</h2>
          <p className="mt-2 text-sm text-muted">{t('Blog.emptySubtitle')}</p>
        </div>
      ) : (
        <ul className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3" data-testid="blog-posts">
          {blog.posts.map((post) => (
            <li key={post.id}>
              <article className="flex flex-col gap-3">
                <Link
                  className="block aspect-[3/2] overflow-hidden rounded-(--radius-card) bg-surface"
                  href={post.href}
                >
                  {post.image && (
                    <Image
                      alt={post.image.alt}
                      className="size-full object-cover"
                      height={300}
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                      src={post.image.src}
                      width={450}
                    />
                  )}
                </Link>

                <div>
                  <h2 className="font-medium">
                    <Link className="hover:underline" href={post.href}>
                      {post.name}
                    </Link>
                  </h2>
                  <p className="mt-1 text-xs text-muted">
                    <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
                    {post.author && ` · ${post.author}`}
                  </p>
                  <p className="mt-2 text-sm text-muted">{post.summary}</p>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}

      {!isSinglePage(blog.pagination) && blog.pagination.hasNextPage && (
        <nav aria-label={t('Listing.pagination')} className="mt-10 flex justify-center">
          <Link
            className="rounded-(--radius-control) border border-border px-4 py-2 text-sm hover:bg-accent"
            href={`/blog?${new URLSearchParams({
              ...(tag && { tag }),
              ...(blog.pagination.endCursor && { after: blog.pagination.endCursor }),
            }).toString()}`}
          >
            {t('Listing.next')}
          </Link>
        </nav>
      )}
    </>
  );
}

function BlogSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="mt-4 h-9 w-48" />
      <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((index) => (
          <div className="flex flex-col gap-3" key={index}>
            <Skeleton className="aspect-[3/2] w-full" />
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
          </div>
        ))}
      </div>
    </>
  );
}
