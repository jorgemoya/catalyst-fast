import { describe, expect, it } from 'vitest';

import { EventWindow, tagsForScope } from './webhooks';

describe('tagsForScope', () => {
  it('invalidates the product, its price and the collection on a product edit', () => {
    expect(tagsForScope({ scope: 'store/product/updated', data: { id: 77 } })).toEqual([
      'product:77',
      'product:77:price',
      'products',
    ]);
  });

  /*
   * The regression this guards: `store/product/inventory/updated` also starts
   * with `store/product/`, so ordering the checks the other way round makes
   * every stock movement invalidate price entries too. On a busy store that is
   * effectively continuous price invalidation.
   */
  it('treats inventory as inventory, not as a product edit', () => {
    const result = tagsForScope({ scope: 'store/product/inventory/updated', data: { id: 77 } });

    expect(result).toEqual(['product:77:inventory', 'inventory']);
    expect(result).not.toContain('product:77:price');
    expect(result).not.toContain('products');
  });

  it('treats an inventory order update the same way', () => {
    expect(tagsForScope({ scope: 'store/product/inventory/order/updated', data: { id: 9 } })).toEqual(
      ['product:9:inventory', 'inventory'],
    );
  });

  it('invalidates navigation alongside categories, since the header renders the tree', () => {
    expect(tagsForScope({ scope: 'store/category/updated', data: { id: 12 } })).toEqual([
      'category:12',
      'category:12:products',
      'categories',
      'navigation',
    ]);
  });

  it('handles brands', () => {
    expect(tagsForScope({ scope: 'store/brand/deleted', data: { id: 4 } })).toEqual([
      'brand:4',
      'brand:4:products',
      'brands',
    ]);
  });

  it('falls back to the collection when no entity id is present', () => {
    expect(tagsForScope({ scope: 'store/product/updated' })).toEqual(['products']);
  });

  it('maps settings to settings and navigation', () => {
    expect(tagsForScope({ scope: 'store/settings/general/updated' })).toEqual([
      'settings',
      'navigation',
    ]);
  });

  /*
   * Unmodelled scopes must map to nothing rather than throw: the receiver
   * answers 200 so BigCommerce does not retry and eventually deactivate the
   * subscriptions we do care about.
   */
  it('returns no tags for scopes we do not model', () => {
    expect(tagsForScope({ scope: 'store/cart/converted', data: { id: 1 } })).toEqual([]);
    expect(tagsForScope({ scope: 'nonsense' })).toEqual([]);
  });
});

describe('EventWindow', () => {
  it('does not saturate under the limit', () => {
    const window = new EventWindow(3, 1000);

    expect(window.record(1000)).toBe(false);
    expect(window.record(1001)).toBe(false);
    expect(window.record(1002)).toBe(false);
  });

  it('saturates once the limit is exceeded within the window', () => {
    const window = new EventWindow(3, 1000);

    [1000, 1001, 1002].forEach((at) => window.record(at));

    expect(window.record(1003)).toBe(true);
  });

  it('forgets events that fall outside the window', () => {
    const window = new EventWindow(3, 1000);

    [1000, 1001, 1002, 1003].forEach((at) => window.record(at));
    expect(window.size).toBe(4);

    // Far enough ahead that every earlier event has aged out.
    expect(window.record(5000)).toBe(false);
    expect(window.size).toBe(1);
  });
});
