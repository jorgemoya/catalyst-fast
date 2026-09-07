import { cacheLife, cacheTag } from 'next/cache';

import type { Breadcrumb } from '~/domain/breadcrumbs';
import { toSafeHtml } from '~/domain/html';
import type { Pagination } from '~/domain/pagination';
import { query } from '~/lib/bigcommerce';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { PaginationFragment } from '~/lib/bigcommerce/fragments/pagination';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';
import { buildConfig } from '~/lib/config';
import { env } from '~/lib/env';

/**
 * Merchant content: web pages and blog posts.
 *
 * All of it is `'use cache'` on the `content` profile — the longest-lived in the
 * system (stale 300 / revalidate 3600 / expire 7 days). A merchant's About page
 * changes a few times a year, so anything shorter is spending origin requests to
 * discover that nothing changed. Freshness comes from webhooks, not from the
 * revalidate interval.
 *
 * **Every `htmlBody` here goes through `toSafeHtml`.** This is merchant-authored
 * WYSIWYG markup rendered with `dangerouslySetInnerHTML`, which is a stored-XSS
 * vector on an ecommerce site — and its `/content/` image paths 404 headlessly
 * without the CDN rewrite. Sanitizing inside the cached read means the *safe*
 * HTML is what gets stored, so the work happens once per entry rather than per
 * render.
 */

const cdnHost = () => buildConfig.get('urls').cdnUrls[0] ?? '';

/* ── Web pages ────────────────────────────────────────────────────────────── */

const WebPageBreadcrumbsFragment = graphql(`
  fragment WebPageBreadcrumbsFragment on WebPage {
    breadcrumbs(depth: 5) {
      edges {
        node {
          name
          path
        }
      }
    }
  }
`);

const WebPageQuery = graphql(
  `
    query WebPage($id: ID!) {
      node(id: $id) {
        __typename
        ... on NormalPage {
          entityId
          name
          path
          htmlBody
          seo {
            pageTitle
            metaDescription
            metaKeywords
          }
          ...WebPageBreadcrumbsFragment
        }
        ... on ContactPage {
          entityId
          name
          path
          htmlBody
          contactFields
          seo {
            pageTitle
            metaDescription
            metaKeywords
          }
          ...WebPageBreadcrumbsFragment
        }
      }
    }
  `,
  [WebPageBreadcrumbsFragment],
);

export interface WebPage {
  kind: 'normal' | 'contact';
  id: number;
  name: string;
  path: string;
  /** Sanitized. May be null when the page is empty or sanitizes down to nothing. */
  body: string | null;
  breadcrumbs: Breadcrumb[];
  seo: { pageTitle: string; metaDescription: string; metaKeywords: string };
  /**
   * Which optional fields the merchant enabled on a contact form. Empty for a
   * normal page. `email` and `comments` are always required and never appear
   * here — BigCommerce treats them as implicit.
   */
  contactFields: string[];
}

const EMPTY_SEO = { pageTitle: '', metaDescription: '', metaKeywords: '' };

/**
 * Keyed by the GraphQL node id, which is what the proxy rewrites into the path
 * (`/webpages/{id}/normal/`). It is opaque and base64-ish, but it is a scalar and
 * stable, so it makes a fine cache key.
 */
export async function getWebpage(id: string): Promise<WebPage | null> {
  'use cache';
  cacheLife('content');
  cacheTag(tags.webpage(id), tags.content);

  const data = await query({ document: WebPageQuery, variables: { id } });
  const node = data.node;

  if (node?.__typename !== 'NormalPage' && node?.__typename !== 'ContactPage') {
    return null;
  }

  return {
    kind: node.__typename === 'ContactPage' ? 'contact' : 'normal',
    id: node.entityId,
    name: node.name,
    path: node.path,
    body: toSafeHtml(node.htmlBody, cdnHost(), env.BIGCOMMERCE_STORE_HASH),
    breadcrumbs: removeEdgesAndNodes(node.breadcrumbs).map((crumb) => ({
      label: crumb.name,
      href: crumb.path ?? '#',
    })),
    seo: node.seo ?? EMPTY_SEO,
    contactFields: node.__typename === 'ContactPage' ? [...node.contactFields] : [],
  };
}

/* ── Blog ─────────────────────────────────────────────────────────────────── */

const BlogPostsQuery = graphql(
  `
    query BlogPosts($first: Int, $after: String, $filters: BlogPostsFiltersInput) {
      site {
        content {
          blog {
            name
            description
            path
            posts(first: $first, after: $after, filters: $filters) {
              edges {
                node {
                  entityId
                  name
                  path
                  author
                  plainTextSummary(characterLimit: 200)
                  publishedDate {
                    utc
                  }
                  thumbnailImage {
                    url: urlTemplate(lossy: true)
                    altText
                  }
                }
              }
              pageInfo {
                ...PaginationFragment
              }
            }
          }
        }
      }
    }
  `,
  [PaginationFragment],
);

export interface BlogPostCard {
  id: number;
  name: string;
  href: string;
  author: string | null;
  summary: string;
  /** ISO instant. Formatting is locale-bound and belongs in the UI. */
  publishedAt: string;
  image: { src: string; alt: string } | null;
}

export interface BlogIndex {
  name: string;
  description: string;
  path: string;
  posts: BlogPostCard[];
  pagination: Pagination;
}

export const BLOG_PAGE_SIZE = 9;

/**
 * `tag` is part of the cache key, and that is the whole reason it is a separate
 * argument rather than being read from `searchParams` here: tags are a bounded,
 * merchant-defined set, so each one gets its own long-lived entry instead of
 * fragmenting the cache the way an arbitrary query string would.
 */
export async function getBlogPosts(tag?: string, after?: string): Promise<BlogIndex | null> {
  'use cache';
  cacheLife('content');
  cacheTag(tags.content);

  const data = await query({
    document: BlogPostsQuery,
    variables: {
      first: BLOG_PAGE_SIZE,
      after: after ?? null,
      // `null` when untagged, never `{ tags: [null] }` — BigCommerce reads that
      // as "posts whose tag is null" and returns nothing, which showed up as an
      // empty blog index rather than an error.
      filters: tag ? { tags: [tag] } : null,
    },
  });

  const blog = data.site.content.blog;

  if (!blog) {
    return null;
  }

  return {
    name: blog.name,
    description: blog.description,
    path: blog.path,
    posts: removeEdgesAndNodes(blog.posts).map((post) => ({
      id: post.entityId,
      name: post.name,
      href: post.path,
      author: post.author || null,
      summary: post.plainTextSummary,
      publishedAt: String(post.publishedDate.utc),
      image: post.thumbnailImage
        ? { src: post.thumbnailImage.url, alt: post.thumbnailImage.altText }
        : null,
    })),
    pagination: blog.posts.pageInfo,
  };
}

const BlogPostQuery = graphql(`
  query BlogPost($entityId: Int!) {
    site {
      content {
        blog {
          name
          path
          post(entityId: $entityId) {
            entityId
            name
            path
            author
            htmlBody
            tags
            publishedDate {
              utc
            }
            thumbnailImage {
              url: urlTemplate(lossy: true)
              altText
            }
            seo {
              pageTitle
              metaDescription
              metaKeywords
            }
          }
        }
      }
    }
  }
`);

export interface BlogPost {
  id: number;
  name: string;
  path: string;
  author: string | null;
  /** Sanitized merchant HTML. */
  body: string | null;
  tags: string[];
  publishedAt: string;
  image: { src: string; alt: string } | null;
  seo: { pageTitle: string; metaDescription: string; metaKeywords: string };
  blog: { name: string; path: string };
}

export async function getBlogPost(entityId: number): Promise<BlogPost | null> {
  'use cache';
  cacheLife('content');
  cacheTag(tags.blogPost(entityId), tags.content);

  const data = await query({ document: BlogPostQuery, variables: { entityId } });
  const blog = data.site.content.blog;
  const post = blog?.post;

  if (!blog || !post) {
    return null;
  }

  return {
    id: post.entityId,
    name: post.name,
    path: post.path,
    author: post.author || null,
    body: toSafeHtml(post.htmlBody, cdnHost(), env.BIGCOMMERCE_STORE_HASH),
    tags: [...post.tags],
    publishedAt: String(post.publishedDate.utc),
    image: post.thumbnailImage
      ? { src: post.thumbnailImage.url, alt: post.thumbnailImage.altText }
      : null,
    seo: post.seo ?? EMPTY_SEO,
    blog: { name: blog.name, path: blog.path },
  };
}
