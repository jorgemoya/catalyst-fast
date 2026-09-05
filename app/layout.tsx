import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import { buildConfig } from '~/lib/config';
import { t } from '~/lib/i18n/messages';

import '~/styles/globals.css';

// Self-hosted and preloaded by next/font — no external request, so the CSP stays
// tight and there is no render-blocking font fetch on the critical path.
const inter = Inter({
  subsets: ['latin'],
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
