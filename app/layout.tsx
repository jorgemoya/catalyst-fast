import type { Metadata } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';

import { buildConfig } from '~/lib/config';
import { t } from '~/lib/i18n/messages';

import '~/styles/globals.css';

/*
 * Vendored, not fetched at build time.
 *
 * `next/font/google` self-hosts what it serves, but it still downloads the font
 * from Google *during the build*. A build without egress to fonts.gstatic.com
 * does not fail — it silently ships the fallback stack, so the first anyone
 * notices is that production is rendering in system-ui. That is a bad failure
 * mode for an air-gapped or network-restricted CI, and it makes builds
 * non-reproducible in a way nothing surfaces.
 *
 * The file in ./fonts is the exact woff2 `next/font/google` would have fetched
 * for the latin subset (Inter variable, 48KB). Checked in, so the build has one
 * fewer network dependency and byte-identical output every time.
 */
const inter = localFont({
  src: './fonts/inter-latin-variable.woff2',
  // Variable font: one file covers the whole range, so there is no per-weight
  // request and `font-weight` interpolates continuously.
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(buildConfig.get('urls').vanityUrl),
  title: {
    template: `%s | ${t('Common.storeName')}`,
    default: t('Common.storeName'),
  },
};

/**
 * Root layout.
 *
 * Reads NOTHING request-scoped — no `cookies()`, no `headers()`, no
 * `getLocale()`. That is the single most important property of this file.
 *
 * Catalyst's root layout read cookies, which forced every route beneath it to
 * render dynamically and made `generateStaticParams` pointless (its own comment
 * says as much). Everything here comes from build-config or static messages, so
 * the layout lands in the prerendered shell and each route decides its own
 * dynamism.
 *
 * When session-dependent chrome arrives (cart badge, account menu in Phase 1/4),
 * it goes in a `<Suspense>` boundary inside the storefront layout — never here.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html className={inter.variable} lang="en" suppressHydrationWarning>
      <body>
        <a
          className="sr-only focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:z-50 focus:rounded-(--radius-control) focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
          href="#main"
        >
          {t('Common.skipToContent')}
        </a>
        {children}
      </body>
    </html>
  );
}
