'use client';

import { t } from '~/lib/i18n/messages';

/**
 * Last-resort boundary, for errors thrown by the root layout itself.
 *
 * It replaces the entire document, so unlike every other component it must
 * render its own `<html>` and `<body>` — the root layout is precisely what
 * failed. That also means no theme, fonts, or global stylesheet are guaranteed
 * to have loaded, so the styling here is deliberately inline and minimal rather
 * than relying on the design tokens.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
        }}
      >
        <h1 style={{ fontSize: '1.5rem', margin: 0 }}>{t('Error.title')}</h1>
        <p style={{ color: '#666', margin: 0 }}>{t('Error.subtitle')}</p>
        {error.digest && (
          <p style={{ color: '#999', fontSize: '0.75rem', margin: 0 }}>{error.digest}</p>
        )}
        <button
          onClick={reset}
          style={{
            alignSelf: 'flex-start',
            padding: '0.5rem 1rem',
            border: '1px solid #ccc',
            borderRadius: '0.5rem',
            background: 'transparent',
            cursor: 'pointer',
          }}
          type="button"
        >
          {t('Error.retry')}
        </button>
      </body>
    </html>
  );
}
