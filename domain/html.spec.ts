import { describe, expect, it } from 'vitest';

import { rewriteWysiwygUrls, sanitizeHtml, toSafeHtml } from './html';

const CDN = 'cdn11.bigcommerce.com';
const HASH = 'abc123';

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    expect(sanitizeHtml('<p>Hi</p><script>alert(1)</script>')).toBe('<p>Hi</p>');
  });

  it('strips inline event handlers', () => {
    // The attribute allow-list means nothing has to enumerate `on*` — anything
    // unlisted is dropped.
    expect(sanitizeHtml('<p onclick="steal()">Hi</p>')).toBe('<p>Hi</p>');
    expect(sanitizeHtml('<img src="x" onerror="steal()">')).not.toContain('onerror');
  });

  it('strips javascript: URLs', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:');
  });

  it('strips style tags and inline styles', () => {
    expect(sanitizeHtml('<style>body{display:none}</style><p style="color:red">Hi</p>')).toBe(
      '<p>Hi</p>',
    );
  });

  it('keeps the formatting a WYSIWYG editor actually produces', () => {
    const out = sanitizeHtml(
      '<h2>Care</h2><p><strong>Water</strong> weekly.</p><ul><li>Bright light</li></ul>' +
        '<table><tr><td>Size</td></tr></table>',
    );

    // Asserted by content rather than exact string: the parser normalizes markup
    // (adding an implied `<tbody>`, for one), and pinning the exact output would
    // make this a test of the parser instead of the allow-list.
    for (const fragment of ['<h2>Care</h2>', '<strong>Water</strong>', '<li>Bright light</li>', '<td>Size</td>']) {
      expect(out).toContain(fragment);
    }
  });

  it('keeps images with their attributes', () => {
    const html = '<img src="https://cdn11.bigcommerce.com/a.jpg" alt="A" width="100">';

    expect(sanitizeHtml(html)).toContain('src="https://cdn11.bigcommerce.com/a.jpg"');
    expect(sanitizeHtml(html)).toContain('alt="A"');
  });

  it('allows video embeds only from known hosts', () => {
    expect(sanitizeHtml('<iframe src="https://www.youtube.com/embed/x"></iframe>')).toContain(
      'youtube.com',
    );
    expect(sanitizeHtml('<iframe src="https://evil.test/x"></iframe>')).toBe('');
  });

  it('hardens external links', () => {
    // `noopener` is a security control: without it the opened page can navigate
    // the opener via `window.opener`.
    const out = sanitizeHtml('<a href="https://example.com">x</a>');

    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('leaves internal links alone', () => {
    expect(sanitizeHtml('<a href="/about/">x</a>')).not.toContain('target=');
  });
});

describe('rewriteWysiwygUrls', () => {
  it('rewrites WebDAV asset paths to the CDN', () => {
    // These resolve on a same-domain Stencil storefront and 404 headlessly, so
    // an unrewritten description renders broken images.
    expect(rewriteWysiwygUrls('<img src="/content/a.png">', CDN, HASH)).toBe(
      `<img src="https://${CDN}/s-${HASH}/content/a.png">`,
    );
    expect(rewriteWysiwygUrls('<img src="/product_images/b.jpg">', CDN, HASH)).toContain(
      `https://${CDN}/s-${HASH}/product_images/b.jpg`,
    );
  });

  it('leaves ordinary internal links untouched', () => {
    // Scoped to the two known WebDAV folders — a page link must not be rewritten
    // to the CDN.
    expect(rewriteWysiwygUrls('<a href="/about-us/">x</a>', CDN, HASH)).toBe(
      '<a href="/about-us/">x</a>',
    );
  });

  it('leaves absolute URLs untouched', () => {
    const html = '<img src="https://example.com/content/a.png">';

    expect(rewriteWysiwygUrls(html, CDN, HASH)).toBe(html);
  });

  it('is a no-op without CDN configuration', () => {
    const html = '<img src="/content/a.png">';

    expect(rewriteWysiwygUrls(html, '', HASH)).toBe(html);
  });
});

describe('toSafeHtml', () => {
  it('rewrites then sanitizes', () => {
    const out = toSafeHtml('<img src="/content/a.png"><script>x()</script>', CDN, HASH);

    expect(out).toContain(`https://${CDN}/s-${HASH}/content/a.png`);
    expect(out).not.toContain('script');
  });

  it('returns null for empty or whitespace-only content', () => {
    expect(toSafeHtml(null, CDN, HASH)).toBeNull();
    expect(toSafeHtml('', CDN, HASH)).toBeNull();
    // Content that sanitizes down to nothing must not render an empty section.
    expect(toSafeHtml('<script>x()</script>', CDN, HASH)).toBeNull();
  });
});
