import { getT } from '~/lib/i18n/server';
import { type Breadcrumb, ELLIPSIS, truncateBreadcrumbs } from '~/domain/breadcrumbs';
import { Link } from '~/ui/primitives/link';

export async function Breadcrumbs({ items }: { items: Breadcrumb[] }) {
  const t = await getT();

  if (items.length === 0) {
    return null;
  }

  // Deep category trees produce trails that wrap and push the heading below the
  // fold; the middle is elided rather than the tail, since the nearest ancestors
  // carry the most meaning.
  const visible = truncateBreadcrumbs(items);

  return (
    <nav aria-label={t('Listing.breadcrumb')}>
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        <li>
          <Link className="hover:text-foreground" href="/">
            {t('Common.home')}
          </Link>
        </li>
        {visible.map((item, index) => {
          const isLast = index === visible.length - 1;

          if (item === ELLIPSIS) {
            return (
              <li aria-hidden="true" className="flex items-center gap-1.5" key="ellipsis">
                <span>/</span>
                <span>{ELLIPSIS}</span>
              </li>
            );
          }

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
