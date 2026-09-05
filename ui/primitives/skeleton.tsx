import { cn } from '~/lib/cn';

/**
 * Suspense fallback placeholder.
 *
 * Every skeleton in the app comes from here rather than being hand-authored per
 * section. Catalyst had six bespoke skeleton components inside `product-detail`
 * alone, which is a symptom of sections owning their own Suspense boundaries —
 * here the page owns the boundary, so it composes skeletons from one primitive.
 *
 * The pulse is disabled under `prefers-reduced-motion` globally (styles/globals.css),
 * which matters because skeletons animate during page load.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-(--radius-control) bg-surface', className)}
    />
  );
}
