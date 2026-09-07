import { cn } from '~/lib/cn';

/**
 * The **only** place merchant-authored HTML is rendered.
 *
 * `dangerouslySetInnerHTML` was previously spelled out at each call site, which
 * meant the repo audit had several places to check and each new one was an
 * opportunity to forget `toSafeHtml`. Funnelling them through one component makes
 * the invariant greppable: if this is the sole occurrence, then sanitization is a
 * property of the data layer rather than a habit at the call site.
 *
 * **The contract: `html` must already have been through `toSafeHtml`.** That
 * happens inside `data/` — see `data/product.ts`, `data/catalog.ts`,
 * `data/content.ts` — so the sanitized form is what gets cached and the work
 * happens once per cache entry rather than once per render. Passing raw
 * BigCommerce HTML here is a stored-XSS vector.
 */
export function Prose({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn(
        'max-w-prose text-sm [&_a]:underline [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_li]:ms-4 [&_li]:list-disc [&_p]:mb-3 [&_table]:w-full [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2',
        className,
      )}
      // Safe by construction: `toSafeHtml` runs inside the cached read.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
