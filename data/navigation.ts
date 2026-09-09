import { cacheLife, cacheTag } from 'next/cache';

import { query } from '~/lib/bigcommerce';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { graphql } from '~/lib/bigcommerce/graphql';
import { tags } from '~/lib/cache/tags';

import { activeLocale } from './locale';

/**
 * Navigation data, split by depth and by branch.
 *
 * **Why it's split.** `Site.categoryTree` takes only `rootEntityId` — there is no
 * `first:` argument, so it always returns every top-level category. The only
 * thing under our control is *selection depth*. A single query selecting three
 * levels therefore scales with the whole catalog: on a store with 1000
 * categories it returns a multi-megabyte tree, held in one cache entry, to
 * render six menu panels.
 *
 * So instead:
 *   - `getTopLevelCategories` selects ONE level. Even at 1000 categories that is
 *     tens of KB, and it is the list the header, footer, and drawer all share.
 *   - `getCategoryBranch` fetches one branch at a time via `rootEntityId`, so the
 *     six visible panels are six small entries that invalidate independently.
 *
 * Seven small cached entries instead of one huge one. On a small store that is a
 * few extra round trips on a cold cache; on a large one it is the difference
 * between a viable nav and an unusable one.
 *
 * This supersedes an earlier single `getNavigation()` that selected three levels
 * for every top-level category at once.
 */

/**
 * Caps on what is *rendered*. Fetching is bounded separately (above) — these
 * exist because HTML size scales with rendered links, and every one of these
 * appears on every page of the site.
 */
export const NAV_LIMITS = {
  /** Top-level items in the header bar. More overflows mid-size viewports. */
  header: 6,
  /** Links in the footer's "Shop" column. */
  footer: 8,
  /** Top-level links in the mobile drawer. */
  mobile: 12,
} as const;

const TopLevelCategoriesQuery = graphql(`
  query TopLevelCategories {
    site {
      categoryTree {
        entityId
        name
        path
      }
    }
  }
`);

const CategoryBranchQuery = graphql(`
  query CategoryBranch($rootEntityId: Int!) {
    site {
      categoryTree(rootEntityId: $rootEntityId) {
        entityId
        name
        path
        children {
          entityId
          name
          path
          children {
            entityId
            name
            path
          }
        }
      }
    }
  }
`);

const SiteLinksQuery = graphql(`
  query SiteLinks($first: Int!) {
    site {
      brands(first: $first) {
        edges {
          node {
            entityId
            name
            path
          }
        }
      }
      content {
        pages(filters: { parentEntityIds: [0] }) {
          edges {
            node {
              __typename
              name
              isVisibleInNavigation
              ... on RawHtmlPage {
                path
              }
              ... on ContactPage {
                path
              }
              ... on NormalPage {
                path
              }
              ... on BlogIndexPage {
                path
              }
              ... on ExternalLinkPage {
                link
              }
            }
          }
        }
      }
    }
  }
`);

export interface NavLink {
  label: string;
  href: string;
}

export interface CategoryNode extends NavLink {
  id: number;
  children: CategoryNode[];
}

/** Every top-level category, names and paths only. Shared by header, footer, drawer. */
export async function getTopLevelCategories(): Promise<Array<NavLink & { id: number }>> {
  'use cache';
  cacheLife('navigation');
  cacheTag(tags.navigation, tags.categories);

  const data = await query({ document: TopLevelCategoriesQuery,
    locale: await activeLocale(),
  });

  return data.site.categoryTree.map((category) => ({
    id: category.entityId,
    label: category.name,
    href: category.path,
  }));
}

/**
 * The subtree beneath one category, two levels deep — what a single mega-menu
 * panel renders. `categoryTree(rootEntityId:)` returns the root node itself with
 * children nested, so the children are unwrapped here.
 */
export async function getCategoryBranch(rootEntityId: number): Promise<CategoryNode[]> {
  'use cache';
  cacheLife('navigation');
  cacheTag(tags.navigation, tags.category(rootEntityId), tags.categories);

  const data = await query({ document: CategoryBranchQuery, variables: { rootEntityId },
    locale: await activeLocale(),
  });
  const root = data.site.categoryTree[0];

  if (!root) {
    return [];
  }

  return root.children.map((child) => ({
    id: child.entityId,
    label: child.name,
    href: child.path,
    children: child.children.map((grandchild) => ({
      id: grandchild.entityId,
      label: grandchild.name,
      href: grandchild.path,
      children: [],
    })),
  }));
}

/** Brand and CMS-page links for the footer. */
export async function getSiteLinks(): Promise<{ brands: NavLink[]; pages: NavLink[] }> {
  'use cache';
  cacheLife('navigation');
  cacheTag(tags.navigation, tags.brands, tags.content);

  const data = await query({ document: SiteLinksQuery, variables: { first: NAV_LIMITS.footer },
    locale: await activeLocale(),
  });

  return {
    brands: removeEdgesAndNodes(data.site.brands).map((brand) => ({
      label: brand.name,
      href: brand.path,
    })),
    pages: removeEdgesAndNodes(data.site.content.pages)
      .filter((page) => page.isVisibleInNavigation)
      .map((page) => ({
        label: page.name,
        // ExternalLinkPage carries `link`; every other page type carries `path`.
        href: 'path' in page ? page.path : 'link' in page ? page.link : '',
      }))
      .filter((link) => link.href !== ''),
  };
}
