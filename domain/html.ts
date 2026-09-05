import sanitize from 'sanitize-html';

/**
 * Merchant-authored WYSIWYG HTML, made safe and made to resolve.
 *
 * Two independent problems, both of which apply to every description, warranty,
 * and category blurb the storefront renders:
 *
 * **1. It is untrusted input.** The content comes from BigCommerce's control
 * panel, so a compromised merchant account — or a staff user with catalog access
 * but no business injecting scripts — can execute arbitrary JS on the storefront.
 * On an ecommerce site that means session theft or a card skimmer. Catalyst runs
 * DOMPurify for exactly this reason; rendering it raw through
 * `dangerouslySetInnerHTML` is a stored-XSS vector.
 *
 * **2. Its asset URLs don't resolve headlessly.** The WYSIWYG editor stores
 * uploaded images as store-root-relative WebDAV paths (`/content/…`,
 * `/product_images/…`). Those work on a same-domain Stencil storefront and 404
 * on ours, so any description with an embedded image renders broken.
 *
 * Both run inside `data/`, so the *sanitized, rewritten* HTML is what gets
 * cached — the work happens once per cache entry rather than on every render.
 */

/**
 * Scoped to the two known WebDAV asset folders so ordinary internal page links
 * (`/about-us/`) are left alone.
 */
const WEBDAV_ASSET_URL = /(src|href)=("|')(\/(?:content|product_images)\/[^"']*)\2/gi;

/**
 * WebDAV folders are mirrored to the CDN at `/s-{storeHash}{path}`.
 */
export function rewriteWysiwygUrls(html: string, cdnHost: string, storeHash: string): string {
  if (!cdnHost || !storeHash) {
    return html;
  }

  return html.replace(
    WEBDAV_ASSET_URL,
    (_match, attr: string, quote: string, path: string) =>
      `${attr}=${quote}https://${cdnHost}/s-${storeHash}${path}${quote}`,
  );
}

/**
 * Allow-list, not a block-list: anything unlisted is stripped, so a tag or
 * attribute we didn't anticipate can't slip through.
 *
 * The list covers what a WYSIWYG editor actually produces — formatting, lists,
 * tables, links, images, and video embeds. Notably absent: `script`, `style`,
 * event handlers, and `javascript:` URLs.
 */
const SANITIZE_OPTIONS: sanitize.IOptions = {
  allowedTags: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr', 'div', 'span', 'blockquote', 'pre', 'code',
    'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small', 'mark',
    'ul', 'ol', 'li', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
    'a', 'img', 'figure', 'figcaption',
    'iframe',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
    // Merchants embed YouTube/Vimeo in descriptions; the frame source is
    // restricted by `allowedIframeHostnames` below.
    iframe: ['src', 'width', 'height', 'title', 'allow', 'allowfullscreen', 'frameborder'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
    col: ['span'],
    '*': ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowedIframeHostnames: ['www.youtube.com', 'youtube.com', 'player.vimeo.com'],
  // Anything pointing off-site opens in a new tab without handing the opener
  // over — `noopener` is a security control, not a nicety.
  /**
   * Stripping a disallowed `src` leaves an empty `<iframe></iframe>` behind,
   * which still renders as a blank box. Drop the element entirely instead.
   */
  exclusiveFilter: (frame) => frame.tag === 'iframe' && !frame.attribs.src,
  transformTags: {
    a: (tagName, attribs) => {
      const href = attribs.href ?? '';
      const isExternal = /^https?:\/\//i.test(href);

      return {
        tagName,
        attribs: isExternal
          ? { ...attribs, target: '_blank', rel: 'noopener noreferrer' }
          : attribs,
      };
    },
  },
};

export function sanitizeHtml(html: string): string {
  return sanitize(html, SANITIZE_OPTIONS);
}

/** Sanitize and rewrite in one pass — what every `data/` caller wants. */
export function toSafeHtml(
  html: string | null | undefined,
  cdnHost: string,
  storeHash: string,
): string | null {
  if (!html) {
    return null;
  }

  // Rewrite first: sanitizing afterwards validates the URLs we just produced,
  // rather than trusting our own substitution.
  const safe = sanitizeHtml(rewriteWysiwygUrls(html, cdnHost, storeHash));

  return safe.trim() || null;
}
