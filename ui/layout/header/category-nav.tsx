import { type CategoryNode, getCategoryBranch, getTopLevelCategories, NAV_LIMITS } from '~/data/navigation';
import { Skeleton } from '~/ui/primitives/skeleton';

import { NavMenu, NavMenuItem, NavPanelLink } from './nav-menu';

/**
 * Mega-menu contents: an async Server Component rendering into the client shell
 * as `children`, so no category data crosses the RSC boundary as props.
 *
 * Each visible panel's branch is fetched separately, so the bar's cost is
 * proportional to what is *displayed* (`NAV_LIMITS.header` panels) rather than to
 * catalog size. The previous single 3-level query returned the entire tree
 * regardless of how much was rendered — unusable on a store with 1000 categories.
 *
 * Branches are resolved here rather than inside each panel because
 * `NavMenuItem` needs to know whether a category *has* children before it
 * renders: with children it's a disclosure button, without it's a plain link. A
 * child component that resolves to `null` still counts as a truthy `children`
 * prop, which would make every category a button and strand the childless ones.
 */

export async function CategoryNav() {
  const categories = await getTopLevelCategories();
  const visible = categories.slice(0, NAV_LIMITS.header);

  // Parallel, and every one is a cached read — on a warm cache this is free.
  const branches = await Promise.all(visible.map((category) => getCategoryBranch(category.id)));

  return (
    <NavMenu>
      {visible.map((category, index) => {
        const groups = branches[index] ?? [];

        return (
          <NavMenuItem href={category.href} key={category.id} label={category.label}>
            {groups.length > 0 ? <CategoryPanel groups={groups} /> : undefined}
          </NavMenuItem>
        );
      })}
    </NavMenu>
  );
}

/**
 * Subcategory groups only. The "Shop all X" link that heads the panel is owned by
 * `NavMenuItem`, which renders it for every category that has children — putting
 * one here too is what produced a duplicated link.
 */
function CategoryPanel({ groups }: { groups: CategoryNode[] }) {
  return (
    <>
      {/* auto-fit rather than a fixed column count: the popup sizes to its
          content, so `grid-cols-4` would squeeze a category with several
          subcategory groups into a narrow panel. This grows to fit and wraps. */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(9rem,1fr))] gap-x-8 gap-y-6">
        {groups.map((group) => (
          <div key={group.id}>
            <NavPanelLink className="text-sm font-semibold hover:text-primary" href={group.href}>
              {group.label}
            </NavPanelLink>

            {group.children.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1.5">
                {group.children.map((child) => (
                  <li key={child.id}>
                    <NavPanelLink
                      className="text-sm text-muted hover:text-foreground"
                      href={child.href}
                    >
                      {child.label}
                    </NavPanelLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

export function CategoryNavSkeleton() {
  return (
    <div className="flex items-center gap-2 max-lg:hidden">
      {Array.from({ length: 4 }, (_, index) => (
        <Skeleton className="h-8 w-20" key={index} />
      ))}
    </div>
  );
}
