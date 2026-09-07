/**
 * Store-specific paths, in one place.
 *
 * Every one of these is a *merchant vanity URL* on the connected BigCommerce
 * channel, not a fact about this codebase — so pointing the app at a different
 * channel invalidates all of them at once. That happened, and the paths were
 * scattered across four spec files; keeping them here makes a channel switch a
 * single edit and makes it obvious which assertions are store-dependent.
 *
 * When these need updating, `scratchpad/probe4.mjs` in the session notes queries
 * a channel for its categories, products, pages, and blog in one shot.
 *
 * Current channel: "Catalyst Canary" (`catalyst-demo-site`).
 */

/** A product with no options — the shortest path to a populated cart. */
export const SIMPLE_PRODUCT = '/orbit-terrarium-large/';

/**
 * A product with **two required** option groups, rendered as different controls:
 * Color is a `Swatch`, Size is `RectangleBoxes`. Both must be answered before the
 * CTA enables, which is what the required-option gating test needs.
 */
export const PRODUCT_WITH_OPTIONS = '/fog-linen-chambray-towel-beige-stripe/';

/** Out of stock, so the disabled-CTA path can be asserted against real data. */
export const OUT_OF_STOCK_PRODUCT = '/dustpan-brush/';

/** A category with child categories, for subcategory links and the mega-menu. */
export const CATEGORY_WITH_CHILDREN = '/kitchen/';

/** A flat category. */
export const CATEGORY = '/garden/';

export const BRAND = '/brands/sagaform/';

export const BLOG_POST = '/your-first-blog-post/';
/** A tag on the post above. */
export const BLOG_TAG = 'SEO';

/** A merchant `NormalPage` — WYSIWYG body, no form. */
export const NORMAL_PAGE = '/shipping-returns/';

/** A merchant `ContactPage`. This one enables all five optional fields. */
export const CONTACT_PAGE = '/contact-us/';

/** A term that matches products on this catalog. */
export const SEARCH_TERM = 'towel';
