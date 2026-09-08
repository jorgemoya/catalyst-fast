/**
 * Shared by the server-rendered wishlist toggle and its client popover.
 *
 * In its own module with **no imports** for a structural reason: the client
 * button previously took it from `wishlist-toggle.tsx`, which is a Server
 * Component reaching `data/customer/session` → `server-only`. That pulled the
 * whole customer data layer into the client graph and failed the build. A shared
 * leaf like this must not live in a file that touches the server.
 */
export function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      height="18"
      viewBox="0 0 24 24"
      width="18"
    >
      <path
        d="M12 20s-7-4.35-7-9a4 4 0 0 1 7-2.65A4 4 0 0 1 19 11c0 4.65-7 9-7 9Z"
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}
