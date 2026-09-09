'use client';

import { useTranslations } from 'next-intl';

import { Dialog } from '@base-ui/react/dialog';
import { useState, useSyncExternalStore } from 'react';

import {
  CONSENT_CATEGORIES,
  CONSENT_COOKIE_NAME,
  type ConsentCategory,
  parseConsent,
  serializeConsent,
} from '~/domain/consent';

/**
 * Cookie consent banner and preferences dialog.
 *
 * **A client island on purpose, and this is the whole point of the design.**
 * Consent lives in a cookie. Deciding server-side whether to show a banner means
 * reading that cookie in a Server Component, which makes the component dynamic —
 * and since the banner sits in the root layout, that would make *every page
 * dynamic for every visitor*. A storefront whose entire value proposition is a
 * prerendered static shell cannot afford to give it up for a cookie bar.
 *
 * So the server always renders this component, it always ships, and it decides
 * in the browser whether to appear. The cost is one small client component and a
 * banner that paints a frame after hydration rather than in the initial HTML —
 * which is the correct trade, and is also how the shopper experiences it either
 * way, since a banner is not LCP content.
 *
 * The cookie is read via `useSyncExternalStore` with a separate server snapshot,
 * so the prerendered HTML consistently contains no banner and the client decides
 * after hydration. See the note above `subscribeToConsent`.
 */
interface Props {
  /** Store setting. When false there is no banner and everything is permitted. */
  enabled: boolean;
  /** Days before the choice is re-asked. */
  maxAgeDays?: number;
}

type Selection = Record<ConsentCategory, boolean>;

const ALL_GRANTED: Selection = { functionality: true, marketing: true, measurement: true };
const NONE_GRANTED: Selection = { functionality: false, marketing: false, measurement: false };

function readCookie(name: string): string | undefined {
  return document.cookie
    .split('; ')
    .find((row) => row.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/*
 * The cookie is read through `useSyncExternalStore` rather than in an effect.
 *
 * Two problems it solves at once. React 19 rejects `setState` inside an effect
 * (`react-hooks/set-state-in-effect`), and reading `document.cookie` during
 * render would mismatch the server HTML, where there is no document. A store
 * with a distinct server snapshot is the sanctioned answer: the server renders
 * "no cookie", the client subscribes and re-reads, and there is no effect and no
 * mismatch.
 *
 * `subscribe` listens for the same `cf:consent` event that `persist` dispatches,
 * so saving a choice updates the banner and the analytics dispatcher together
 * without a reload.
 */
const subscribeToConsent = (onChange: () => void): (() => void) => {
  window.addEventListener('cf:consent', onChange);

  return () => window.removeEventListener('cf:consent', onChange);
};

const getConsentSnapshot = (): string => readCookie(CONSENT_COOKIE_NAME) ?? '';

/** No cookies exist during prerender, so the server always sees "undecided". */
const getServerConsentSnapshot = (): string => '';

export function ConsentBanner({ enabled, maxAgeDays = 365 }: Props) {
  const t = useTranslations();

  /*
   * Inside the component, because it is translated — at module scope it would be
   * evaluated once at import and pin every locale to the first one loaded.
   *
   * Still spelled out rather than built with `t(`Consent.${category}`)`: the
   * translator is typed against the catalogue, so a template-literal key defeats
   * the check that the string exists. Written this way, deleting a message is a
   * compile error rather than a raw "Consent.marketing" shown to a shopper.
   */
  const CATEGORY_COPY: Record<ConsentCategory, { label: string; description: string }> = {
    functionality: {
      label: t('Consent.functionality'),
      description: t('Consent.functionalityDescription'),
    },
    marketing: {
      label: t('Consent.marketing'),
      description: t('Consent.marketingDescription'),
    },
    measurement: {
      label: t('Consent.measurement'),
      description: t('Consent.measurementDescription'),
    },
  };

  const rawCookie = useSyncExternalStore(
    subscribeToConsent,
    getConsentSnapshot,
    getServerConsentSnapshot,
  );

  const existing = parseConsent(rawCookie ? decodeURIComponent(rawCookie) : undefined);

  const [customizing, setCustomizing] = useState(false);
  const [selection, setSelection] = useState<Selection>(NONE_GRANTED);

  const needsChoice = enabled && existing === null;

  const persist = (choice: Selection): void => {
    const value = encodeURIComponent(serializeConsent(choice));

    /*
     * `SameSite=Lax` and not `Strict`: the consent choice must survive a
     * shopper arriving from an external link or returning from the hosted
     * checkout, and Strict would drop it on exactly those navigations, so the
     * banner would reappear after every checkout.
     *
     * Not `Secure` unconditionally, because local development is http.
     */
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';

    document.cookie = `${CONSENT_COOKIE_NAME}=${value}; Path=/; Max-Age=${
      maxAgeDays * 24 * 60 * 60
    }; SameSite=Lax${secure}`;

    setSelection(choice);
    setCustomizing(false);

    // Let listeners (the analytics dispatcher) react without a reload.
    window.dispatchEvent(new CustomEvent('cf:consent', { detail: choice }));
  };

  if (!enabled || !needsChoice) {
    return null;
  }

  return (
    <>
      <div
        aria-label={t('Consent.title')}
        className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-background p-4 shadow-lg"
        role="region"
      >
        <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-foreground">{t('Consent.description')}</p>

          <div className="flex shrink-0 gap-2">
            <button
              className="rounded-(--radius-control) border border-border px-3 py-2 text-sm hover:bg-accent"
              onClick={() => setCustomizing(true)}
              type="button"
            >
              {t('Consent.customize')}
            </button>
            <button
              className="rounded-(--radius-control) border border-border px-3 py-2 text-sm hover:bg-accent"
              onClick={() => persist(NONE_GRANTED)}
              type="button"
            >
              {t('Consent.declineAll')}
            </button>
            <button
              className="rounded-(--radius-control) bg-foreground px-3 py-2 text-sm text-background"
              onClick={() => persist(ALL_GRANTED)}
              type="button"
            >
              {t('Consent.acceptAll')}
            </button>
          </div>
        </div>
      </div>

      <Dialog.Root onOpenChange={setCustomizing} open={customizing}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/40" />
          <Dialog.Popup className="fixed left-1/2 top-1/2 z-50 w-[min(32rem,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-(--radius-control) border border-border bg-background p-6">
            <Dialog.Title className="text-lg font-semibold">
              {t('Consent.preferences')}
            </Dialog.Title>

            <ul className="mt-4 space-y-3">
              {/* Necessary is listed but not toggleable — it is what makes the
                  site work, and offering a switch that does nothing is worse
                  than being honest that there is no choice. */}
              <li className="flex items-start gap-3">
                <input aria-label={t('Consent.necessary')} checked disabled type="checkbox" />
                <span>
                  <span className="block text-sm font-medium">{t('Consent.necessary')}</span>
                  <span className="block text-sm text-muted">
                    {t('Consent.necessaryDescription')}
                  </span>
                </span>
              </li>

              {CONSENT_CATEGORIES.map((category) => (
                <li className="flex items-start gap-3" key={category}>
                  <input
                    aria-label={CATEGORY_COPY[category].label}
                    checked={selection[category]}
                    onChange={(event) =>
                      setSelection({ ...selection, [category]: event.target.checked })
                    }
                    type="checkbox"
                  />
                  <span>
                    <span className="block text-sm font-medium">
                      {CATEGORY_COPY[category].label}
                    </span>
                    <span className="block text-sm text-muted">
                      {CATEGORY_COPY[category].description}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-(--radius-control) border border-border px-3 py-2 text-sm hover:bg-accent"
                onClick={() => setCustomizing(false)}
                type="button"
              >
                {t('Common.cancel')}
              </button>
              <button
                className="rounded-(--radius-control) bg-foreground px-3 py-2 text-sm text-background"
                onClick={() => persist(selection)}
                type="button"
              >
                {t('Consent.save')}
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
