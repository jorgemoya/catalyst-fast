import { getT } from '~/lib/i18n/server';
import type { Facet, FacetOption } from '~/domain/facets';
import type { RawSearchParams } from '~/domain/listing-params';
import { resetFiltersHref, setValueHref, toggleValueHref } from '~/domain/listing-url';
import { cn } from '~/lib/cn';
import { Link } from '~/ui/primitives/link';
import { Rating } from '~/ui/primitives/rating';
import { Skeleton } from '~/ui/primitives/skeleton';

/**
 * Facet panel. Entirely server-rendered — every control is a link or a plain GET
 * form, so refinement works with JavaScript disabled and every refined view has a
 * crawlable URL. See `domain/listing-url.ts` for why this isn't a client island.
 */

interface Props {
  facets: Facet[];
  pathname: string;
  searchParams: RawSearchParams;
  hasActiveFilters: boolean;
}

export async function Facets({ facets, pathname, searchParams, hasActiveFilters }: Props) {
  const t = await getT();

  if (facets.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-6">
      {hasActiveFilters && (
        <Link
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
          href={resetFiltersHref(pathname, searchParams)}
        >
          {t('Listing.resetFilters')}
        </Link>
      )}

      {facets.map((facet) => (
        <FacetGroup facet={facet} key={`${facet.type}-${facet.paramName}-${facet.label}`}>
          {facet.type === 'toggle-group' && (
            <ToggleGroup
              options={facet.options}
              paramName={facet.paramName}
              pathname={pathname}
              searchParams={searchParams}
            />
          )}

          {facet.type === 'rating' && (
            <RatingFacet pathname={pathname} searchParams={searchParams} selected={facet.selected} />
          )}

          {facet.type === 'range' && (
            <PriceRange max={facet.max} min={facet.min} searchParams={searchParams} />
          )}
        </FacetGroup>
      ))}
    </div>
  );
}

function FacetGroup({
  facet,
  children,
}: {
  facet: Facet;
  children: React.ReactNode;
}) {
  return (
    // <details> gives collapse/expand with no JS, and honors the merchant's
    // isCollapsedByDefault setting via the `open` attribute.
    <details className="group border-b border-border pb-4" open={!facet.defaultCollapsed}>
      <summary className="flex cursor-pointer list-none items-center justify-between py-1 text-sm font-semibold">
        {facet.label}
        <svg
          aria-hidden="true"
          className="transition-transform duration-(--duration-fast) group-open:rotate-180"
          fill="none"
          height="16"
          viewBox="0 0 24 24"
          width="16"
        >
          <path d="m6 9 6 6 6-6" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
        </svg>
      </summary>
      <div className="pt-3">{children}</div>
    </details>
  );
}

function ToggleGroup({
  options,
  paramName,
  pathname,
  searchParams,
}: {
  options: FacetOption[];
  paramName: string;
  pathname: string;
  searchParams: RawSearchParams;
}) {
  return (
    <ul className="flex flex-col gap-1.5">
      {options.map((option) => (
        <li key={option.value}>
          <OptionLink
            option={option}
            paramName={paramName}
            pathname={pathname}
            searchParams={searchParams}
          />

          {option.children && option.children.length > 0 && (
            <ul className="mt-1.5 ms-4 flex flex-col gap-1.5 border-s border-border ps-3">
              {option.children.map((child) => (
                <li key={child.value}>
                  <OptionLink
                    option={child}
                    paramName={paramName}
                    pathname={pathname}
                    searchParams={searchParams}
                  />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function OptionLink({
  option,
  paramName,
  pathname,
  searchParams,
}: {
  option: FacetOption;
  paramName: string;
  pathname: string;
  searchParams: RawSearchParams;
}) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className={cn(
          'flex size-4 shrink-0 items-center justify-center rounded-sm border',
          option.selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border-strong',
        )}
      >
        {option.selected && (
          <svg fill="none" height="10" viewBox="0 0 24 24" width="10">
            <path d="m5 13 4 4L19 7" stroke="currentColor" strokeLinecap="round" strokeWidth="3" />
          </svg>
        )}
      </span>
      <span className="flex-1">{option.label}</span>
      {option.count !== undefined && <span className="text-xs text-muted">{option.count}</span>}
    </>
  );

  // A disabled option is rendered as inert text rather than removed, so the panel
  // doesn't reflow underneath the shopper mid-refinement.
  if (option.disabled) {
    return (
      <span
        aria-disabled="true"
        className="flex cursor-not-allowed items-center gap-2 text-sm text-subtle"
      >
        {content}
      </span>
    );
  }

  return (
    <Link
      aria-pressed={option.selected}
      className="flex items-center gap-2 text-sm hover:text-primary"
      href={toggleValueHref(pathname, searchParams, paramName, option.value)}
    >
      {content}
    </Link>
  );
}

async function RatingFacet({
  pathname,
  searchParams,
  selected,
}: {
  pathname: string;
  searchParams: RawSearchParams;
  selected?: number;
}) {
  const t = await getT();

  return (
    <ul className="flex flex-col gap-1.5">
      {[4, 3, 2, 1].map((rating) => {
        const isSelected = selected === rating;

        return (
          <li key={rating}>
            <Link
              aria-pressed={isSelected}
              className={cn(
                'flex items-center gap-2 text-sm hover:text-primary',
                isSelected && 'font-medium text-primary',
              )}
              // Clicking the active rating clears it, so the filter is its own undo.
              href={setValueHref(
                pathname,
                searchParams,
                'minRating',
                isSelected ? undefined : String(rating),
              )}
            >
              <Rating rating={rating} />
              <span>{t('Listing.ratingAndUp')}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

async function PriceRange({
  min,
  max,
  searchParams,
}: {
  min?: number;
  max?: number;
  searchParams: RawSearchParams;
}) {
  const t = await getT();

  // A plain GET form: submitting replaces the query string, so this needs no JS.
  // Other active params are carried across as hidden inputs.
  const preserved = Object.entries(searchParams).filter(
    ([key]) => !['minPrice', 'maxPrice', 'after', 'before'].includes(key),
  );

  return (
    <form className="flex items-end gap-2" method="get">
      {preserved.flatMap(([key, value]) =>
        (Array.isArray(value) ? value : [value]).map((item, index) =>
          item ? <input key={`${key}-${index}`} name={key} type="hidden" value={item} /> : null,
        ),
      )}

      <label className="flex-1">
        <span className="mb-1 block text-xs text-muted">{t('Listing.min')}</span>
        <input
          className="h-9 w-full rounded-(--radius-control) border border-border bg-background px-2 text-sm"
          defaultValue={min ?? ''}
          inputMode="decimal"
          name="minPrice"
          type="number"
        />
      </label>

      <label className="flex-1">
        <span className="mb-1 block text-xs text-muted">{t('Listing.max')}</span>
        <input
          className="h-9 w-full rounded-(--radius-control) border border-border bg-background px-2 text-sm"
          defaultValue={max ?? ''}
          inputMode="decimal"
          name="maxPrice"
          type="number"
        />
      </label>

      <button
        className="h-9 shrink-0 rounded-(--radius-control) bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        type="submit"
      >
        {t('Listing.apply')}
      </button>
    </form>
  );
}

export function FacetsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      {Array.from({ length: 4 }, (_, group) => (
        <div className="flex flex-col gap-2" key={group}>
          <Skeleton className="h-4 w-24" />
          {Array.from({ length: 4 }, (_, row) => (
            <Skeleton className="h-4 w-full" key={row} />
          ))}
        </div>
      ))}
    </div>
  );
}
