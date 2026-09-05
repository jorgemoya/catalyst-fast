import { cn } from '~/lib/cn';

interface Props {
  rating: number;
  numberOfReviews?: number;
  className?: string;
}

/**
 * Star rating. A pure server component — the fill is done with a clipped overlay
 * rather than per-star math, so a 3.7 renders exactly rather than rounding.
 */
export function Rating({ rating, numberOfReviews, className }: Props) {
  const percent = Math.max(0, Math.min(100, (rating / 5) * 100));
  const label =
    numberOfReviews === undefined
      ? `Rated ${rating} out of 5`
      : `Rated ${rating} out of 5 from ${numberOfReviews} reviews`;

  return (
    <span aria-label={label} className={cn('inline-flex items-center gap-1.5', className)} role="img">
      <span className="relative inline-block text-sm leading-none tracking-tight">
        <span aria-hidden="true" className="text-subtle">
          ★★★★★
        </span>
        <span
          aria-hidden="true"
          className="absolute inset-0 overflow-hidden text-warning"
          style={{ width: `${percent}%` }}
        >
          ★★★★★
        </span>
      </span>
      {numberOfReviews !== undefined && numberOfReviews > 0 && (
        <span aria-hidden="true" className="text-xs text-muted">
          ({numberOfReviews})
        </span>
      )}
    </span>
  );
}
