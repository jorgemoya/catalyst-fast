'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';

import {
  getVariantSnapshot,
  type VariantSnapshot,
} from '~/app/(storefront)/product/[id]/_actions/get-variant';
import type { CtaState } from '~/domain/availability';
import {
  defaultSelection,
  type OptionSelection,
  type ProductOptionField,
  variantSelection,
} from '~/domain/product-options';
import { cn } from '~/lib/cn';
import { formatCurrency, t } from '~/lib/i18n/messages';
import { Image } from '~/ui/primitives/image';

/**
 * Variant selection as **client-owned interaction state**, not navigation state.
 *
 * This is the decision the PDP's caching rests on (plan §4.3). Reading
 * `searchParams` on the server would make the whole page dynamic for every
 * visitor — including the ~95% who never touch an option — so the server always
 * renders the default variant and the shell stays 100% static for guests.
 *
 * On change we call a Server Function that reads the same cached price and
 * inventory entries, then sync the URL with `replaceState` so the selection is
 * still shareable. No router transition, no re-render of the page.
 *
 * The trade-off: a deep-linked variant paints the default first and swaps during
 * hydration. BigCommerce canonicalizes variant URLs to the base product anyway,
 * so nothing is lost for SEO.
 */

interface Props {
  productId: number;
  fields: ProductOptionField[];
  /** Server-rendered default variant state, shown until the shopper changes something. */
  initial: VariantSnapshot;
}

type Selection = OptionSelection;

export function VariantSelector({ productId, fields, initial }: Props) {
  const variantFields = useMemo(() => fields.filter((field) => field.variantDefining), [fields]);
  const [selection, setSelection] = useState<Selection>(() => defaultSelection(fields));
  const [snapshot, setSnapshot] = useState(initial);
  const [isPending, startTransition] = useTransition();

  /*
   * Deep links are read on the *client*. Reading them on the server is what would
   * make the route dynamic; doing it here costs one post-hydration update and
   * keeps the shell static.
   *
   * `set-state-in-effect` is disabled for this effect. The rule exists to catch
   * derived state — state computed from props that belongs in render. This is the
   * other case: fetching external data in response to mount-time browser state,
   * which the rule cannot distinguish and which effects exist for.
   *
   * Both alternatives are worse. Deriving the selection from `useSearchParams`
   * during render fixes the button state but not the price, so a deep-linked
   * variant would show the base product's price until the shopper touched
   * something. Moving the read to the server makes the whole PDP dynamic for
   * every visitor — the one outcome this design exists to prevent.
   */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl: Selection = {};

    for (const field of variantFields) {
      const value = params.get(field.id);

      if (value) {
        fromUrl[field.id] = value;
      }
    }

    if (Object.keys(fromUrl).length > 0) {
      const next = { ...defaultSelection(fields), ...fromUrl };

      setSelection(next);

      startTransition(async () => {
        setSnapshot(await getVariantSnapshot(productId, variantSelection(fields, next)));
      });
    }
    // Intentionally once on mount: this reconciles the URL with the server's
    // default render, and must not re-fire as the shopper changes options.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Required options with nothing chosen.
   *
   * BigCommerce products need not define a default for every option, so a PDP can
   * legitimately load with a required Size and Color unselected. The CTA has to
   * reflect that: offering "Add to cart" when no variant is identified would
   * either fail at the API or silently add the wrong thing.
   *
   * Only variant-defining options gate the CTA. A required *text* field is
   * validated on submit (Phase 4), because unlike a variant it doesn't change
   * what is being bought.
   */
  const missingRequired = variantFields.filter(
    (field) => field.required && !selection[field.id],
  );

  const select = (fieldId: string, value: string) => {
    const next = { ...selection, [fieldId]: value };

    setSelection(next);

    // `replaceState` rather than a router push: the selection stays shareable
    // without a navigation, so nothing re-renders and no cache entry is missed.
    const params = new URLSearchParams(window.location.search);

    for (const field of variantFields) {
      const selected = next[field.id];

      if (selected) {
        params.set(field.id, selected);
      }
    }

    window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);

    // Only variant-defining choices go to BigCommerce. Sending the whole
    // selection would pass a number field's value (say `5`) as if it were an
    // option-value id.
    startTransition(async () => {
      setSnapshot(await getVariantSnapshot(productId, variantSelection(fields, next)));
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <VariantPrice snapshot={snapshot} stale={isPending} />

      {fields.map((field) => (
        <OptionField
          field={field}
          key={field.id}
          onSelect={(value) => select(field.id, value)}
          value={selection[field.id]}
        />
      ))}

      <VariantAvailability snapshot={snapshot} stale={isPending} />

      <button
        className="h-12 rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="add-to-cart"
        // Phase 4 wires this to the cart. Rendered now because the CTA and its
        // enabled/disabled state are part of the shell the PDP must prove.
        disabled={(snapshot.cta?.disabled ?? false) || missingRequired.length > 0}
        type="button"
      >
        {missingRequired.length > 0
          ? t('Product.selectOptions', {
              options: missingRequired.map((field) => field.label).join(' and '),
            })
          : ctaLabel(snapshot.cta?.kind)}
      </button>
    </div>
  );
}

/**
 * Maps the domain's CTA `kind` to copy. The domain deliberately returns
 * semantics rather than a label, so this mapping — and its translations — live
 * in the UI where they belong.
 */
function ctaLabel(kind: CtaState['kind'] | undefined): string {
  switch (kind) {
    case 'preorder':
      return t('Product.preorder');
    case 'out-of-stock':
      return t('Product.outOfStock');
    case 'unavailable':
      return t('Product.unavailable');
    default:
      return t('Product.addToCart');
  }
}

/**
 * Applied to the regions whose value is genuinely stale mid-fetch — price and
 * stock — and never to the options themselves: dimming a control the shopper just
 * clicked reads as "that didn't register", when the selection in fact updated
 * synchronously.
 *
 * The delay is the important part. `getVariantSnapshot` reads cached entries and
 * usually returns in 10–30ms, so an immediate dim is a flicker on every click.
 * Transitioning in only after 200ms means fast responses show nothing at all,
 * and the indicator appears solely when there is real latency to communicate.
 * Removing on `delay-0` keeps the restore instant.
 */
const stalenessClasses = (stale: boolean) =>
  cn('transition-opacity duration-150', stale ? 'opacity-60 delay-200' : 'opacity-100 delay-0');

function VariantPrice({ snapshot, stale }: { snapshot: VariantSnapshot; stale: boolean }) {
  const { price } = snapshot;

  if (!price) {
    return null;
  }

  const money = (value: { inc: number; ex: number; currencyCode: string }) =>
    formatCurrency(price.mode === 'INC' ? value.inc : value.ex, value.currencyCode);

  return (
    <p
      className={cn('text-2xl font-semibold', stalenessClasses(stale))}
      data-testid="product-price"
    >
      {price.type === 'range' && `${money(price.min)} – ${money(price.max)}`}
      {price.type === 'sale' && (
        <>
          <span className="text-price-sale">{money(price.current)}</span>{' '}
          <s className="text-base font-normal text-muted">{money(price.previous)}</s>
        </>
      )}
      {price.type === 'plain' && money(price.money)}
    </p>
  );
}

function VariantAvailability({
  snapshot,
  stale,
}: {
  snapshot: VariantSnapshot;
  stale: boolean;
}) {
  const { stock, backorder, outOfStockMessage } = snapshot;

  return (
    <div
      className={cn('flex flex-col gap-1 text-sm', stalenessClasses(stale))}
      data-testid="product-availability"
    >
      {stock && (
        <p className={stock.isLow ? 'text-warning' : 'text-in-stock'}>
          {stock.isLow
            ? t('Product.onlyLeft', { count: stock.available })
            : t('Product.inStockCount', { count: stock.available })}
        </p>
      )}
      {outOfStockMessage && <p className="text-out-of-stock">{outOfStockMessage}</p>}
      {backorder?.prompt && <p className="text-muted">{backorder.prompt}</p>}
      {backorder?.quantityOnBackorder ? (
        <p className="text-muted">
          {t('Product.onBackorder', { count: backorder.quantityOnBackorder })}
        </p>
      ) : null}
      {backorder?.message && <p className="text-muted">{backorder.message}</p>}
      {backorder?.exceedsAvailable && <p className="text-error">{t('Product.exceedsStock')}</p>}
    </div>
  );
}

 
function OptionField({
  field,
  value,
  onSelect,
}: {
  field: ProductOptionField;
  value?: string;
  onSelect: (value: string) => void;
}) {
  const label = (
    <span className="mb-2 block text-sm font-medium">
      {field.label}
      {field.required && <span className="text-error"> *</span>}
    </span>
  );

  switch (field.type) {
    case 'swatch':
      return (
        <fieldset>
          <legend className="sr-only">{field.label}</legend>
          {label}
          <div className="flex flex-wrap gap-2">
            {field.values.map((option) => (
              <button
                aria-label={option.label}
                aria-pressed={value === option.value}
                className={cn(
                  'size-9 overflow-hidden rounded-full border-2',
                  value === option.value ? 'border-primary' : 'border-border',
                )}
                key={option.value}
                onClick={() => onSelect(option.value)}
                style={option.color ? { backgroundColor: option.color } : undefined}
                title={option.label}
                type="button"
              >
                {option.image && (
                  <Image alt={option.label} height={36} src={option.image.src} width={36} />
                )}
              </button>
            ))}
          </div>
        </fieldset>
      );

    case 'buttons':
    case 'radio':
    case 'cards':
      return (
        <fieldset>
          <legend className="sr-only">{field.label}</legend>
          {label}
          <div className="flex flex-wrap gap-2">
            {field.values.map((option) => (
              <button
                aria-pressed={value === option.value}
                className={cn(
                  'rounded-(--radius-control) border px-3 py-2 text-sm',
                  value === option.value
                    ? 'border-primary bg-accent font-medium'
                    : 'border-border hover:border-border-strong',
                )}
                key={option.value}
                onClick={() => onSelect(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>
      );

    case 'select':
      return (
        <label>
          {label}
          <select
            className="h-10 w-full rounded-(--radius-control) border border-border bg-background px-2 text-sm"
            onChange={(event) => onSelect(event.target.value)}
            value={value ?? ''}
          >
            <option value="">{t('Product.chooseOption')}</option>
            {field.values.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      );

    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input
            checked={value === field.checkedValue}
            className="size-4"
            onChange={(event) =>
              onSelect(event.target.checked ? field.checkedValue : field.uncheckedValue)
            }
            type="checkbox"
          />
          {field.label}
        </label>
      );

    // The personalization inputs below never change price or stock
    // (`variantDefining: false`), so they don't trigger a snapshot fetch. Phase 4
    // collects their values for the cart line.
    case 'number':
      return (
        <label>
          {label}
          <input
            className="h-10 w-full rounded-(--radius-control) border border-border bg-background px-2 text-sm"
            defaultValue={field.defaultValue}
            max={field.max}
            min={field.min}
            step={field.integerOnly ? 1 : 'any'}
            type="number"
          />
        </label>
      );

    case 'text':
      return (
        <label>
          {label}
          <input
            className="h-10 w-full rounded-(--radius-control) border border-border bg-background px-2 text-sm"
            defaultValue={field.defaultValue}
            maxLength={field.maxLength}
            minLength={field.minLength}
            type="text"
          />
        </label>
      );

    case 'textarea':
      return (
        <label>
          {label}
          <textarea
            className="w-full rounded-(--radius-control) border border-border bg-background px-2 py-1.5 text-sm"
            defaultValue={field.defaultValue}
            maxLength={field.maxLength}
            minLength={field.minLength}
            rows={field.maxLines ?? 3}
          />
        </label>
      );

    case 'date':
      return (
        <label>
          {label}
          <input
            className="h-10 w-full rounded-(--radius-control) border border-border bg-background px-2 text-sm"
            defaultValue={field.defaultValue}
            max={field.latest}
            min={field.earliest}
            type="date"
          />
        </label>
      );

    default:
      return null;
  }
}
