/**
 * Social icons, filtered to the platforms the merchant has actually configured.
 *
 * BigCommerce returns a `name` per link (e.g. "Facebook"); anything without an
 * icon here renders as a text link rather than being dropped, so a newly
 * supported platform degrades gracefully instead of vanishing.
 */

const ICONS: Record<string, string> = {
  facebook: 'M14 9h3V6h-3c-2.2 0-4 1.8-4 4v2H8v3h2v7h3v-7h3l1-3h-4v-2c0-.6.4-1 1-1z',
  instagram:
    'M12 2h.01M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm5 5.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM17.5 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
  x: 'M3 3l7.5 9.5L3.5 21H6l5.8-6.9L17 21h4l-7.9-10L20.5 3H18l-5.4 6.4L8 3H3z',
  twitter: 'M3 3l7.5 9.5L3.5 21H6l5.8-6.9L17 21h4l-7.9-10L20.5 3H18l-5.4 6.4L8 3H3z',
  pinterest:
    'M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-5s-.3-.6-.3-1.5c0-1.4.8-2.5 1.9-2.5.9 0 1.3.7 1.3 1.5 0 .9-.6 2.2-.9 3.5-.2 1 .5 1.9 1.6 1.9 1.9 0 3.3-2 3.3-5 0-2.6-1.9-4.4-4.5-4.4-3.1 0-4.9 2.3-4.9 4.7 0 .9.3 1.9.8 2.4.1.1.1.2.1.3l-.3 1.1c0 .2-.2.2-.4.1-1.4-.7-2.3-2.8-2.3-4.5 0-3.6 2.6-7 7.6-7 4 0 7.1 2.8 7.1 6.6 0 4-2.5 7.1-5.9 7.1-1.2 0-2.3-.6-2.6-1.3l-.7 2.7c-.3 1-1 2.3-1.5 3.1A10 10 0 1 0 12 2z',
  youtube:
    'M22 12s0-3.2-.4-4.7a2.5 2.5 0 0 0-1.8-1.8C18.3 5 12 5 12 5s-6.3 0-7.8.5a2.5 2.5 0 0 0-1.8 1.8C2 8.8 2 12 2 12s0 3.2.4 4.7a2.5 2.5 0 0 0 1.8 1.8C5.7 19 12 19 12 19s6.3 0 7.8-.5a2.5 2.5 0 0 0 1.8-1.8C22 15.2 22 12 22 12zM10 15V9l5.2 3-5.2 3z',
  linkedin:
    'M6.9 8H4v12h2.9V8zM5.4 3.5a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4zM20 13.4c0-3.2-1.7-4.7-4-4.7-1.8 0-2.6 1-3.1 1.7V8H10v12h2.9v-6.7c0-1.4.9-2.1 1.9-2.1s1.7.7 1.7 2.1V20H20v-6.6z',
};

export function SocialLinks({ links }: { links: Array<{ name: string; url: string }> }) {
  if (links.length === 0) {
    return null;
  }

  return (
    <ul className="mt-2 flex items-center gap-1">
      {links.map((link) => {
        const path = ICONS[link.name.toLowerCase()];

        return (
          <li key={link.url}>
            <a
              aria-label={link.name}
              className="inline-flex size-8 items-center justify-center rounded-(--radius-control) text-muted hover:bg-accent hover:text-foreground"
              href={link.url}
              rel="noopener noreferrer me"
              target="_blank"
            >
              {path ? (
                <svg aria-hidden="true" height="18" viewBox="0 0 24 24" width="18">
                  <path d={path} fill="currentColor" />
                </svg>
              ) : (
                <span className="text-xs">{link.name.slice(0, 2)}</span>
              )}
            </a>
          </li>
        );
      })}
    </ul>
  );
}
