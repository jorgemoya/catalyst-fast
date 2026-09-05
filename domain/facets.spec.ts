import { describe, expect, it } from 'vitest';

import { type RawFacet, toFacets } from './facets';
import { canonicalizeListingParams, type ListingKey } from './listing-params';

/**
 * All eight BigCommerce facet types, exercised with fixtures.
 *
 * This is deliberate: the demo store only ever surfaces Brand, Price, and Other,
 * so the Category, Product Attribute, and Rating branches would otherwise be
 * written-but-never-run while the docs claimed "all 8 facet types". Fixtures are
 * the honest way to verify a code path the available data can't reach.
 *
 * The `disabled` logic is the subtle part and gets the most attention: BC drops
 * zero-result options from the refined response rather than marking them
 * unavailable, so the two responses are diffed to grey them out instead of
 * letting the panel reflow underneath the shopper mid-refinement.
 */

const base = { isCollapsedByDefault: false, displayProductCount: true };
const emptyKey = (): ListingKey => canonicalizeListingParams({}, {});

const brandFacet = (brands: RawFacet['brands']): RawFacet => ({
  ...base,
  __typename: 'BrandSearchFilter',
  displayName: 'Brand',
  brands,
});

describe('toFacets — brand', () => {
  const all = [
    brandFacet([
      { entityId: 1, name: 'Acme', isSelected: false, productCount: 4 },
      { entityId: 2, name: 'Globex', isSelected: false, productCount: 2 },
    ]),
  ];

  it('maps options with counts and the brand param name', () => {
    const [facet] = toFacets(all, all, emptyKey());

    expect(facet?.type).toBe('toggle-group');
    expect(facet && 'paramName' in facet && facet.paramName).toBe('brand');
    expect(facet && 'options' in facet && facet.options).toEqual([
      { label: 'Acme', value: '1', count: 4, selected: false, disabled: false },
      { label: 'Globex', value: '2', count: 2, selected: false, disabled: false },
    ]);
  });

  it('disables an option missing from the refined response', () => {
    const refined = [brandFacet([{ entityId: 1, name: 'Acme', isSelected: false, productCount: 4 }])];
    const [facet] = toFacets(all, refined, emptyKey());
    const options = facet && 'options' in facet ? facet.options : [];

    expect(options[0]?.disabled).toBe(false);
    expect(options[1]?.disabled).toBe(true);
    // A disabled option shows no count — "0 results here" is noise.
    expect(options[1]?.count).toBeUndefined();
  });

  it('never disables a selected option, so it can always be undone', () => {
    // Selecting Globex can refine Acme out of the results; Globex itself must
    // stay clickable or the shopper is stranded.
    const refined = [brandFacet([{ entityId: 2, name: 'Globex', isSelected: true, productCount: 2 }])];
    const key = canonicalizeListingParams({ brand: ['2'] }, {});
    const [facet] = toFacets(all, refined, key);
    const options = facet && 'options' in facet ? facet.options : [];

    expect(options[1]).toMatchObject({ label: 'Globex', selected: true, disabled: false });
    expect(options[0]).toMatchObject({ label: 'Acme', selected: false, disabled: true });
  });

  it('omits counts when the merchant disabled product counts', () => {
    const noCount = [{ ...all[0], displayProductCount: false } as RawFacet];
    const [facet] = toFacets(noCount, noCount, emptyKey());
    const options = facet && 'options' in facet ? facet.options : [];

    expect(options[0]?.count).toBeUndefined();
  });
});

describe('toFacets — category (nested)', () => {
  const all: RawFacet[] = [
    {
      ...base,
      __typename: 'CategorySearchFilter',
      displayName: 'Category',
      categories: [
        {
          entityId: 10,
          name: 'Plants',
          isSelected: false,
          productCount: 12,
          subCategories: [
            { entityId: 11, name: 'Succulents', isSelected: false, productCount: 5 },
            { entityId: 12, name: 'Ferns', isSelected: false, productCount: 3 },
          ],
        },
      ],
    },
  ];

  it('nests subcategories under their parent', () => {
    const [facet] = toFacets(all, all, emptyKey());
    const options = facet && 'options' in facet ? facet.options : [];

    expect(facet && 'paramName' in facet && facet.paramName).toBe('categoryIn');
    expect(options[0]?.label).toBe('Plants');
    expect(options[0]?.children?.map((child) => child.label)).toEqual(['Succulents', 'Ferns']);
  });

  it('marks a selected subcategory, not just top-level ones', () => {
    const key = canonicalizeListingParams({ categoryIn: ['11'] }, {});
    const [facet] = toFacets(all, all, key);
    const children = (facet && 'options' in facet ? facet.options : [])[0]?.children ?? [];

    expect(children[0]).toMatchObject({ label: 'Succulents', selected: true });
    expect(children[1]).toMatchObject({ label: 'Ferns', selected: false });
  });

  it('disables a subcategory absent from the refined response', () => {
    const refined: RawFacet[] = [
      {
        ...all[0],
        categories: [
          {
            entityId: 10,
            name: 'Plants',
            isSelected: false,
            productCount: 12,
            subCategories: [
              { entityId: 11, name: 'Succulents', isSelected: false, productCount: 5 },
            ],
          },
        ],
      } as RawFacet,
    ];
    const children =
      ((toFacets(all, refined, emptyKey())[0] as { options: Array<{ children?: unknown[] }> })
        .options[0]?.children ?? []) as Array<{ label: string; disabled: boolean }>;

    expect(children[0]).toMatchObject({ label: 'Succulents', disabled: false });
    expect(children[1]).toMatchObject({ label: 'Ferns', disabled: true });
  });
});

describe('toFacets — product attributes', () => {
  const all: RawFacet[] = [
    {
      ...base,
      __typename: 'ProductAttributeSearchFilter',
      displayName: 'Size',
      filterKey: 'size',
      attributes: [
        { value: 'Small', isSelected: false, productCount: 3 },
        { value: 'Large', isSelected: false, productCount: 1 },
      ],
    },
  ];

  it('derives the attr_ param name from the filter key', () => {
    const [facet] = toFacets(all, all, emptyKey());

    expect(facet && 'paramName' in facet && facet.paramName).toBe('attr_size');
  });

  it('matches selection against the right attribute only', () => {
    // A value selected under `attr_color` must not mark the same string selected
    // under `attr_size`.
    const key = canonicalizeListingParams({ attr_color: ['Small'] }, {});
    const [facet] = toFacets(all, all, key);
    const options = facet && 'options' in facet ? facet.options : [];

    expect(options[0]?.selected).toBe(false);

    const sized = canonicalizeListingParams({ attr_size: ['Small'] }, {});
    const [sizedFacet] = toFacets(all, all, sized);
    const sizedOptions = sizedFacet && 'options' in sizedFacet ? sizedFacet.options : [];

    expect(sizedOptions[0]?.selected).toBe(true);
  });
});

describe('toFacets — rating', () => {
  const all: RawFacet[] = [
    {
      ...base,
      __typename: 'RatingSearchFilter',
      displayName: 'Rating',
      ratings: [{ value: '4', isSelected: false, productCount: 6 }],
    },
  ];

  it('reflects the selected minimum rating', () => {
    const key = canonicalizeListingParams({ minRating: '4' }, {});
    const [facet] = toFacets(all, all, key);

    expect(facet?.type).toBe('rating');
    expect(facet && 'selected' in facet && facet.selected).toBe(4);
  });

  it('is disabled when refined away and nothing is selected', () => {
    const [facet] = toFacets(all, [], emptyKey());

    expect(facet && 'disabled' in facet && facet.disabled).toBe(true);
  });
});

describe('toFacets — price range', () => {
  const all: RawFacet[] = [
    {
      ...base,
      __typename: 'PriceSearchFilter',
      displayName: 'Price',
      selected: { minPrice: null, maxPrice: null },
    },
  ];

  it('prefers the shopper’s values over the response defaults', () => {
    const withDefaults: RawFacet[] = [
      { ...all[0], selected: { minPrice: 5, maxPrice: 500 } } as RawFacet,
    ];
    const key = canonicalizeListingParams({ minPrice: '50', maxPrice: '80' }, {});
    const [facet] = toFacets(withDefaults, withDefaults, key);

    expect(facet).toMatchObject({ type: 'range', paramName: 'price', min: 50, max: 80 });
  });

  it('falls back to the response bounds when unset', () => {
    const withDefaults: RawFacet[] = [
      { ...all[0], selected: { minPrice: 5, maxPrice: 500 } } as RawFacet,
    ];
    const [facet] = toFacets(withDefaults, withDefaults, emptyKey());

    expect(facet).toMatchObject({ min: 5, max: 500 });
  });
});

describe('toFacets — other (free shipping / featured / in stock)', () => {
  const all: RawFacet[] = [
    {
      ...base,
      __typename: 'OtherSearchFilter',
      displayName: 'Other',
      freeShipping: { isSelected: false, productCount: 2 },
      isFeatured: { isSelected: false, productCount: 3 },
      isInStock: { isSelected: false, productCount: 9 },
    },
  ];

  it('splits BigCommerce’s combined node into three independent toggles', () => {
    const [facet] = toFacets(all, all, emptyKey());
    const options = facet && 'options' in facet ? facet.options : [];

    expect(options.map((option) => option.value)).toEqual([
      'free_shipping',
      'featured',
      'in_stock',
    ]);
  });

  it('tracks each toggle separately', () => {
    const key = canonicalizeListingParams({ stock: 'in_stock' }, {});
    const [facet] = toFacets(all, all, key);
    const options = facet && 'options' in facet ? facet.options : [];

    expect(options.find((option) => option.value === 'in_stock')?.selected).toBe(true);
    expect(options.find((option) => option.value === 'featured')?.selected).toBe(false);
  });

  it('omits the group entirely when the merchant enabled none of them', () => {
    const none: RawFacet[] = [
      {
        ...base,
        __typename: 'OtherSearchFilter',
        displayName: 'Other',
        freeShipping: null,
        isFeatured: null,
        isInStock: null,
      },
    ];

    expect(toFacets(none, none, emptyKey())).toEqual([]);
  });
});

describe('toFacets — unknown types', () => {
  it('ignores a facet type it does not model rather than crashing', () => {
    // BigCommerce can add filter types; an unrecognized one must not take the
    // whole panel down.
    const unknown: RawFacet[] = [
      { ...base, __typename: 'SomeFutureSearchFilter', displayName: 'Future' },
    ];

    expect(toFacets(unknown, unknown, emptyKey())).toEqual([]);
  });
});
