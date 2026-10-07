import { cacheLife, cacheTag } from 'next/cache';

import { currentAudience } from '~/lib/audience';
import { query } from '~/lib/bigcommerce';
import { type CatalogFetcher, restrictedQuery } from '~/lib/bigcommerce/restricted';
import { removeEdgesAndNodes } from '~/lib/bigcommerce/client';
import { graphql, readFragment, type ResultOf } from '~/lib/bigcommerce/graphql';
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

const MenuBranchFragment = graphql(`
  fragment MenuBranch on CategoryTreeItem {
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
`);

/**
 * Every mega-menu panel in **one request**: one aliased `categoryTree` per
 * header slot. Each alias is the same bounded two-level branch
 * `CategoryBranchQuery` fetches, so the response still scales with what the
 * header displays, never with the catalog — it just arrives in one round trip
 * instead of six. Measured before: 6 `CategoryBranch` calls on every cold render.
 *
 * Six slots because `NAV_LIMITS.header` is six; `MENU_SLOTS` below fails the
 * type check if the two drift. `rootEntityId` is nullable in the schema and
 * `null` means "the whole tree", so unused slots repeat a real id rather than
 * being left empty.
 */
const MenuBranchesQuery = graphql(
  `
  query MenuBranches($r0: Int!, $r1: Int!, $r2: Int!, $r3: Int!, $r4: Int!, $r5: Int!) {
    site {
      b0: categoryTree(rootEntityId: $r0) {
        ...MenuBranch
      }
      b1: categoryTree(rootEntityId: $r1) {
        ...MenuBranch
      }
      b2: categoryTree(rootEntityId: $r2) {
        ...MenuBranch
      }
      b3: categoryTree(rootEntityId: $r3) {
        ...MenuBranch
      }
      b4: categoryTree(rootEntityId: $r4) {
        ...MenuBranch
      }
      b5: categoryTree(rootEntityId: $r5) {
        ...MenuBranch
      }
    }
  }
`,
  [MenuBranchFragment],
);

const MENU_SLOTS = 6 satisfies (typeof NAV_LIMITS)['header'];

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
async function loadTopLevelCategories(
  fetchCatalog: CatalogFetcher,
): Promise<Array<NavLink & { id: number }>> {
  cacheLife('navigation');
  cacheTag(tags.navigation, tags.categories);

  const data = await fetchCatalog({
    document: TopLevelCategoriesQuery,
    locale: await activeLocale(),
  });

  return data.site.categoryTree.map((category) => ({
    id: category.entityId,
    label: category.name,
    href: category.path,
  }));
}

// cache-audit: dispatch — picks the shared or the customer-group catalog by the
// `[audience]` root param; both branches below carry a cache directive.
export async function getTopLevelCategories(): Promise<Array<NavLink & { id: number }>> {
  return (await currentAudience()) === 'restricted'
    ? restrictedTopLevelCategories()
    : sharedTopLevelCategories();
}

/** Shared catalog — guests and every group outside `RESTRICTED_CATALOG_GROUPS`. */
async function sharedTopLevelCategories(): Promise<Array<NavLink & { id: number }>> {
  'use cache: remote';

  return loadTopLevelCategories(query);
}

/**
 * Customer-group catalog — fetched with the shopper's token, so it lives only in
 * a private scope (browser memory, never a shared server cache).
 */
async function restrictedTopLevelCategories(): Promise<Array<NavLink & { id: number }>> {
  'use cache: private';

  return loadTopLevelCategories(restrictedQuery);
}

/**
 * The subtree beneath one category, two levels deep — what a single mega-menu
 * panel renders. `categoryTree(rootEntityId:)` returns the root node itself with
 * children nested, so the children are unwrapped here.
 */
async function loadCategoryBranch(
  fetchCatalog: CatalogFetcher,
  rootEntityId: number,
): Promise<CategoryNode[]> {
  cacheLife('navigation');
  cacheTag(tags.navigation, tags.category(rootEntityId), tags.categories);

  const data = await fetchCatalog({
    document: CategoryBranchQuery,
    variables: { rootEntityId },
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

// cache-audit: dispatch — picks the shared or the customer-group catalog by the
// `[audience]` root param; both branches below carry a cache directive.
export async function getCategoryBranch(rootEntityId: number): Promise<CategoryNode[]> {
  return (await currentAudience()) === 'restricted'
    ? restrictedCategoryBranch(rootEntityId)
    : sharedCategoryBranch(rootEntityId);
}

/** Shared catalog — guests and every group outside `RESTRICTED_CATALOG_GROUPS`. */
async function sharedCategoryBranch(rootEntityId: number): Promise<CategoryNode[]> {
  'use cache: remote';

  return loadCategoryBranch(query, rootEntityId);
}

/**
 * Customer-group catalog — fetched with the shopper's token, so it lives only in
 * a private scope (browser memory, never a shared server cache).
 */
async function restrictedCategoryBranch(rootEntityId: number): Promise<CategoryNode[]> {
  'use cache: private';

  return loadCategoryBranch(restrictedQuery, rootEntityId);
}

type MenuBranchItem = ResultOf<typeof MenuBranchFragment>;

const toBranch = (root: MenuBranchItem | undefined): CategoryNode[] =>
  (root?.children ?? []).map((child) => ({
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

/** The branches under each of `rootEntityIds`, in order — one request. */
async function loadMenuBranches(
  fetchCatalog: CatalogFetcher,
  rootEntityIds: readonly number[],
): Promise<CategoryNode[][]> {
  cacheLife('navigation');
  cacheTag(tags.navigation, tags.categories, ...rootEntityIds.map((id) => tags.category(id)));

  const [first] = rootEntityIds;

  if (first === undefined) {
    return [];
  }

  const ids = Array.from({ length: MENU_SLOTS }, (_, slot) => rootEntityIds[slot] ?? first);
  const data = await fetchCatalog({
    document: MenuBranchesQuery,
    variables: { r0: ids[0]!, r1: ids[1]!, r2: ids[2]!, r3: ids[3]!, r4: ids[4]!, r5: ids[5]! },
    locale: await activeLocale(),
  });
  const { b0, b1, b2, b3, b4, b5 } = data.site;

  return [b0, b1, b2, b3, b4, b5]
    .slice(0, rootEntityIds.length)
    .map((tree) => toBranch(readFragment(MenuBranchFragment, tree[0])));
}

// cache-audit: dispatch — picks the shared or the customer-group catalog by the
// `[audience]` root param; both branches below carry a cache directive.
export async function getMenuBranches(rootEntityIds: readonly number[]): Promise<CategoryNode[][]> {
  const ids = rootEntityIds.slice(0, MENU_SLOTS);

  return (await currentAudience()) === 'restricted'
    ? restrictedMenuBranches(ids)
    : sharedMenuBranches(ids);
}

/** Shared catalog — guests and every group outside `RESTRICTED_CATALOG_GROUPS`. */
async function sharedMenuBranches(rootEntityIds: readonly number[]): Promise<CategoryNode[][]> {
  'use cache: remote';

  return loadMenuBranches(query, rootEntityIds);
}

/**
 * Customer-group catalog — fetched with the shopper's token, so it lives only in
 * a private scope (browser memory, never a shared server cache).
 */
async function restrictedMenuBranches(rootEntityIds: readonly number[]): Promise<CategoryNode[][]> {
  'use cache: private';

  return loadMenuBranches(restrictedQuery, rootEntityIds);
}

/** Brand and CMS-page links for the footer. */
async function loadSiteLinks(
  fetchCatalog: CatalogFetcher,
): Promise<{ brands: NavLink[]; pages: NavLink[] }> {
  cacheLife('navigation');
  cacheTag(tags.navigation, tags.brands, tags.content);

  const data = await fetchCatalog({
    document: SiteLinksQuery,
    variables: { first: NAV_LIMITS.footer },
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

// cache-audit: dispatch — picks the shared or the customer-group catalog by the
// `[audience]` root param; both branches below carry a cache directive.
export async function getSiteLinks(): Promise<{ brands: NavLink[]; pages: NavLink[] }> {
  return (await currentAudience()) === 'restricted'
    ? restrictedSiteLinks()
    : sharedSiteLinks();
}

/** Shared catalog — guests and every group outside `RESTRICTED_CATALOG_GROUPS`. */
async function sharedSiteLinks(): Promise<{ brands: NavLink[]; pages: NavLink[] }> {
  'use cache: remote';

  return loadSiteLinks(query);
}

/**
 * Customer-group catalog — fetched with the shopper's token, so it lives only in
 * a private scope (browser memory, never a shared server cache).
 */
async function restrictedSiteLinks(): Promise<{ brands: NavLink[]; pages: NavLink[] }> {
  'use cache: private';

  return loadSiteLinks(restrictedQuery);
}
