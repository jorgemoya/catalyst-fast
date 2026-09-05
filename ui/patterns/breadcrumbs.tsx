import type { Breadcrumb } from '~/data/catalog';
import { Link } from '~/ui/primitives/link';

export function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <li>
          <Link className="hover:text-foreground" href="/">
            Home
          </Link>
        </li>
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <li className="flex items-center gap-1.5" key={`${item.href}-${item.label}`}>
              <span aria-hidden="true">/</span>
              {isLast ? (
                // The current page is not a link, and carries aria-current so
                // screen readers announce position rather than a dead link.
                <span aria-current="page" className="text-foreground">
                  {item.label}
                </span>
              ) : (
                <Link className="hover:text-foreground" href={item.href}>
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
