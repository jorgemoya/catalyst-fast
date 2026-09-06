import { Link } from '~/ui/primitives/link';

/**
 * The header's icon buttons. Extracted so the cart badge — which is a separate
 * component with its own cache scope — renders identically to the static ones
 * beside it, including in its loading state.
 */
export function IconLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      aria-label={label}
      className="relative inline-flex size-9 items-center justify-center rounded-(--radius-control) hover:bg-accent"
      href={href}
    >
      {children}
    </Link>
  );
}

export function CartIcon() {
  return (
    <svg aria-hidden="true" fill="none" height="18" viewBox="0 0 24 24" width="18">
      <path
        d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.4a2 2 0 0 0 2-1.55L20.5 8H6"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="2"
      />
      <circle cx="10" cy="20" r="1.5" fill="currentColor" />
      <circle cx="17" cy="20" r="1.5" fill="currentColor" />
    </svg>
  );
}
