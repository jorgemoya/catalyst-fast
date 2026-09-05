import type { ListingKey } from './listing-params';

/**
 * Facet domain model covering all eight BigCommerce filter types.
 *
 * The `disabled` flag is the subtle part. BigCommerce's facet response reflects
 * the *current* refinement, so an option that would yield zero results simply
 * disappears rather than being marked unavailable. To show it greyed out instead
 * of vanishing (which is far less disorienting mid-refinement), we diff two
 * responses: the unrefined facet list, and the refined one. An option present in
 * the former but absent from the latter is disabled — unless it's currently
 * selected, in which case it must stay interactive so it can be deselected.
 */

export interface FacetOption {
  label: string;
  value: string;
  count?: number;
  selected: boolean;
  disabled: boolean;
  /** Nested subcategories, only ever populated for the category facet. */
  children?: FacetOption[];
}

export type Facet =
  | {
      type: 'toggle-group';
      paramName: string;
      label: string;
      defaultCollapsed: boolean;
      options: FacetOption[];
    }
  | {
      type: 'range';
      paramName: 'price';
      label: string;
      defaultCollapsed: boolean;
      min?: number;
      max?: number;
    }
  | {
      type: 'rating';
      paramName: 'minRating';
      label: string;
      defaultCollapsed: boolean;
      selected?: number;
      disabled: boolean;
    };

/**
 * Structural view of the BigCommerce facet union after edges/nodes flattening.
 * Every variant-specific field is optional because one shape has to cover all
 * six `__typename`s; the switch below narrows on `__typename` before reading them.
 */
export interface RawFacet {
  __typename: string;
  displayName: string;
  isCollapsedByDefault: boolean;
  displayProductCount?: boolean;
  filterKey?: string;
  brands?: Array<{ entityId: number; name: string; isSelected: boolean; productCount: number }>;
  categories?: Array<{
    entityId: number;
    name: string;
    isSelected: boolean;
    productCount: number;
    subCategories?: Array<{
      entityId: number;
      name: string;
      isSelected: boolean;
      productCount: number;
    }>;
  }>;
  attributes?: Array<{ value: string; isSelected: boolean; productCount: number }>;
  ratings?: Array<{ value: string; isSelected: boolean; productCount: number }>;
  selected?: { minPrice: number | null; maxPrice: number | null } | null;
  freeShipping?: { isSelected: boolean; productCount: number } | null;
  isFeatured?: { isSelected: boolean; productCount: number } | null;
  isInStock?: { isSelected: boolean; productCount: number } | null;
}

function toOption(
  { label, value, count }: { label: string; value: string; count: number },
  { selected, availableInRefined, showCount }: {
    selected: boolean;
    availableInRefined: boolean;
    showCount: boolean;
  },
): FacetOption {
  // A selected option is never disabled — the shopper must be able to undo it.
  const disabled = !availableInRefined && !selected;

  return {
    label,
    value,
    // Counts on a disabled option would read as "0 results here", which is noise.
    count: showCount && !disabled ? count : undefined,
    selected,
    disabled,
  };
}

export function toFacets(
  allFacets: RawFacet[],
  refinedFacets: RawFacet[],
  key: ListingKey,
): Facet[] {
  const facets: Facet[] = [];

  for (const facet of allFacets) {
    const refined = refinedFacets.find((candidate) => candidate.displayName === facet.displayName);
    const showCount = facet.displayProductCount ?? false;
    const defaultCollapsed = facet.isCollapsedByDefault;

    switch (facet.__typename) {
      case 'CategorySearchFilter': {
        const options = (facet.categories ?? []).map((category) => {
          const refinedCategory = refined?.categories?.find(
            (candidate) => candidate.entityId === category.entityId,
          );
          const option = toOption(
            { label: category.name, value: String(category.entityId), count: category.productCount },
            {
              selected: key.categoryIn?.includes(category.entityId) ?? false,
              availableInRefined: refinedCategory != null,
              showCount,
            },
          );

          return {
            ...option,
            children: (category.subCategories ?? []).map((sub) =>
              toOption(
                { label: sub.name, value: String(sub.entityId), count: sub.productCount },
                {
                  selected: key.categoryIn?.includes(sub.entityId) ?? false,
                  availableInRefined:
                    refinedCategory?.subCategories?.some(
                      (candidate) => candidate.entityId === sub.entityId,
                    ) ?? false,
                  showCount,
                },
              ),
            ),
          };
        });

        facets.push({
          type: 'toggle-group',
          paramName: 'categoryIn',
          label: facet.displayName,
          defaultCollapsed,
          options,
        });
        break;
      }

      case 'BrandSearchFilter': {
        facets.push({
          type: 'toggle-group',
          paramName: 'brand',
          label: facet.displayName,
          defaultCollapsed,
          options: (facet.brands ?? []).map((brand) =>
            toOption(
              { label: brand.name, value: String(brand.entityId), count: brand.productCount },
              {
                selected: key.brands?.includes(brand.entityId) ?? false,
                availableInRefined:
                  refined?.brands?.some((candidate) => candidate.entityId === brand.entityId) ??
                  false,
                showCount,
              },
            ),
          ),
        });
        break;
      }

      case 'ProductAttributeSearchFilter': {
        const attributeKey = facet.filterKey ?? '';
        const selectedValues =
          key.attributes?.find(([name]) => name === attributeKey)?.[1] ?? [];

        facets.push({
          type: 'toggle-group',
          paramName: `attr_${attributeKey}`,
          label: facet.displayName,
          defaultCollapsed,
          options: (facet.attributes ?? []).map((attribute) =>
            toOption(
              { label: attribute.value, value: attribute.value, count: attribute.productCount },
              {
                selected: selectedValues.includes(attribute.value),
                availableInRefined:
                  refined?.attributes?.some(
                    (candidate) => candidate.value === attribute.value,
                  ) ?? false,
                showCount,
              },
            ),
          ),
        });
        break;
      }

      case 'RatingSearchFilter': {
        facets.push({
          type: 'rating',
          paramName: 'minRating',
          label: facet.displayName,
          defaultCollapsed,
          selected: key.minRating,
          disabled: refined == null && key.minRating === undefined,
        });
        break;
      }

      case 'PriceSearchFilter': {
        facets.push({
          type: 'range',
          paramName: 'price',
          label: facet.displayName,
          defaultCollapsed,
          min: key.minPrice ?? facet.selected?.minPrice ?? undefined,
          max: key.maxPrice ?? facet.selected?.maxPrice ?? undefined,
        });
        break;
      }

      case 'OtherSearchFilter': {
        // BigCommerce groups three unrelated booleans into one filter node; split
        // them into individual toggles so each can be cleared on its own.
        const options: FacetOption[] = [];

        if (facet.freeShipping) {
          options.push(
            toOption(
              { label: 'Free shipping', value: 'free_shipping', count: facet.freeShipping.productCount },
              {
                selected: key.freeShipping ?? false,
                availableInRefined: refined?.freeShipping != null,
                showCount,
              },
            ),
          );
        }

        if (facet.isFeatured) {
          options.push(
            toOption(
              { label: 'Featured', value: 'featured', count: facet.isFeatured.productCount },
              {
                selected: key.isFeatured ?? false,
                availableInRefined: refined?.isFeatured != null,
                showCount,
              },
            ),
          );
        }

        if (facet.isInStock) {
          options.push(
            toOption(
              { label: 'In stock', value: 'in_stock', count: facet.isInStock.productCount },
              {
                selected: key.inStock ?? false,
                availableInRefined: refined?.isInStock != null,
                showCount,
              },
            ),
          );
        }

        if (options.length > 0) {
          facets.push({
            type: 'toggle-group',
            paramName: 'other',
            label: facet.displayName,
            defaultCollapsed,
            options,
          });
        }

        break;
      }

      default:
        break;
    }
  }

  return facets;
}
