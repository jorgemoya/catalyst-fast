import { getFormatDate, getT } from '~/lib/i18n/server';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { getBlogPost } from '~/data/content';
import { Breadcrumbs } from '~/ui/patterns/breadcrumbs';
import { Prose } from '~/ui/patterns/prose';
import { Image } from '~/ui/primitives/image';
import { Link } from '~/ui/primitives/link';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * A blog post. Reached as a proxy rewrite target from the merchant's post URL,
 * so `[id]` is the BigCommerce entityId.
 */

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = await getBlogPost(Number((await params).id));

  if (!post) {
    return {};
  }

  return {
    title: post.seo.pageTitle || post.name,
    description: post.seo.metaDescription || undefined,
    keywords: post.seo.metaKeywords || undefined,
    alternates: { canonical: post.path },
    openGraph: {
      type: 'article',
      publishedTime: post.publishedAt,
      ...(post.image && { images: [{ url: post.image.src, alt: post.image.alt }] }),
    },
  };
}

export default function BlogPostPage({ params }: Props) {
  return (
    <Suspense fallback={<PostSkeleton />}>
      <PostContent params={params} />
    </Suspense>
  );
}

async function PostContent({ params }: Props) {
  const t = await getT();
  const formatDate = await getFormatDate();

  const post = await getBlogPost(Number((await params).id));

  if (!post) {
    notFound();
  }

  return (
    <article className="page-container py-8">
      <Breadcrumbs
        items={[
          { label: post.blog.name, href: post.blog.path },
          { label: post.name, href: post.path },
        ]}
      />

      <header className="mt-4">
        <h1 className="text-3xl font-semibold tracking-tight">{post.name}</h1>
        <p className="mt-2 text-sm text-muted">
          <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          {post.author && ` · ${post.author}`}
        </p>
      </header>

      {post.image && (
        <Image
          alt={post.image.alt}
          className="mt-6 w-full rounded-(--radius-card) object-cover"
          height={600}
          // The post hero is the LCP element on this route.
          priority
          sizes="(min-width: 1024px) 1024px, 100vw"
          src={post.image.src}
          width={1024}
        />
      )}

      {/* Sanitized in `data/content.ts`; see the contract on `Prose`. */}
      {post.body && <Prose className="mt-8 text-foreground" html={post.body} />}

      {post.tags.length > 0 && (
        <footer className="mt-10 flex flex-wrap items-center gap-2 border-t border-border pt-6">
          <span className="text-sm text-muted">{t('Blog.tags')}</span>
          {post.tags.map((tag) => (
            <Link
              className="rounded-(--radius-control) border border-border px-2 py-1 text-xs hover:bg-accent"
              href={`/blog?tag=${encodeURIComponent(tag)}`}
              key={tag}
            >
              {tag}
            </Link>
          ))}
        </footer>
      )}
    </article>
  );
}

function PostSkeleton() {
  return (
    <div className="page-container py-8">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-4 h-9 w-3/4" />
      <Skeleton className="mt-2 h-4 w-48" />
      <Skeleton className="mt-6 aspect-[16/9] w-full" />
      <div className="mt-8 flex flex-col gap-3">
        <Skeleton className="h-4 w-full max-w-prose" />
        <Skeleton className="h-4 w-full max-w-prose" />
        <Skeleton className="h-4 w-2/3 max-w-prose" />
      </div>
    </div>
  );
}
