import { permanentRedirect } from 'next/navigation';

/**
 * Legacy Stencil sitemap path → `/sitemap.xml`.
 *
 * Exists purely for continuity: a store migrating from Stencil has
 * `/xmlsitemap.php` already submitted to Search Console and linked from its old
 * `robots.txt`. A 301 preserves that rather than making the merchant resubmit.
 *
 * The odd-looking `.php` directory name is intentional — it is a literal path
 * segment, not a PHP file.
 */
export function GET(): never {
  permanentRedirect('/sitemap.xml');
}
