'use client';

import { useLocale, useTranslations } from 'next-intl';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';

import { addToCart } from '~/app/[locale]/(storefront)/product/[id]/_actions/add-to-cart';
import {
  getVariantSnapshot,
  type VariantSnapshot,
} from '~/app/[locale]/(storefront)/product/[id]/_actions/get-variant';
import {
  type CtaState,
  toBackorderDisplay,
  toCtaState,
  toOutOfStockMessage,
  toStockDisplay,
} from '~/domain/availability';
import {
  defaultSelection,
  type OptionSelection,
  type ProductOptionField,
  variantSelection,
} from '~/domain/product-options';
import { cn } from '~/lib/cn';
import { formatCurrencyIn } from '~/lib/i18n/messages';
import { Link } from '~/ui/primitives/link';

import { OptionField } from './option-fields';
import { QuantityStepper } from './quantity-stepper';

/**
 * The PDP's purchase region: options, price, stock, quantity, and add to cart.
 *
 * **Variant selection is client-owned interaction state, not navigation state.**
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
 *
 * Stock and backorder state are *derived here* from the snapshot's raw
 * availability rather than fetched. They depend on quantity, and the derivations
 * are pure — computing them on the client makes the stepper instant instead of
 * costing a round trip per click.
 */

interface Props {
  productId: number;
  fields: ProductOptionField[];
  quantityLimits: { min: number; max: number | null };
  /** Server-rendered default variant state, shown until the shopper changes something. */
  initial: VariantSnapshot;
}

type Selection = OptionSelection;

export function PurchaseForm({ productId, fields, quantityLimits, initial }: Props) {
  const t = useTranslations();

  const variantFields = useMemo(() => fields.filter((field) => field.variantDefining), [fields]);
  const [selection, setSelection] = useState<Selection>(() => defaultSelection(fields));
  const [snapshot, setSnapshot] = useState(initial);
  const [quantity, setQuantity] = useState(quantityLimits.min);
  const [isResolving, startTransition] = useTransition();

  const [result, formAction, isSubmitting] = useActionState(
    addToCart.bind(null, productId),
    null,
  );

  const errors = result?.error ?? {};
  const formErrors = errors[''] ?? [];
  const wasAdded = result?.status === 'success';

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
   * validated on submit, because unlike a variant it doesn't change what is being
   * bought.
   */
  const missingRequired = variantFields.filter((field) => field.required && !selection[field.id]);

  const derived = useMemo(() => {
    const { availability, inventory } = snapshot;

    if (!availability) {
      return { cta: null, stock: null, backorder: null, outOfStockMessage: null };
    }

    return {
      cta: toCtaState(availability),
      stock: toStockDisplay(availability, inventory),
      backorder: toBackorderDisplay(availability, inventory, quantity),
      outOfStockMessage: toOutOfStockMessage(availability, inventory),
    };
  }, [snapshot, quantity]);

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

  const blocked =
    (derived.cta?.disabled ?? false) ||
    missingRequired.length > 0 ||
    (derived.backorder?.exceedsAvailable ?? false);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <VariantPrice price={snapshot.price} stale={isResolving} />

      {fields.map((field) => (
        <OptionField
          errors={errors[`option.${field.id}`] ?? undefined}
          field={field}
          key={field.id}
          name={`option.${field.id}`}
          onSelect={(value) => select(field.id, value)}
          value={field.variantDefining ? (selection[field.id] ?? '') : undefined}
        />
      ))}

      <VariantAvailability derived={derived} stale={isResolving} />

      <QuantityStepper
        decrementLabel={t('Product.decreaseQuantity')}
        disabled={isSubmitting}
        incrementLabel={t('Product.increaseQuantity')}
        label={t('Product.quantity')}
        max={quantityLimits.max}
        min={quantityLimits.min}
        name="quantity"
        onChange={setQuantity}
        value={quantity}
      />

      <button
        className="h-12 rounded-(--radius-control) bg-primary px-6 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        data-testid="add-to-cart"
        disabled={blocked || isSubmitting}
        type="submit"
      >
        {missingRequired.length > 0
          ? t('Product.selectOptions', {
              options: missingRequired.map((field) => field.label).join(' and '),
            })
          : ctaLabel(derived.cta?.kind, isSubmitting, t)}
      </button>

      {formErrors.length > 0 && (
        <p className="text-sm text-error" role="alert">
          {formErrors.join(' ')}
        </p>
      )}

      {wasAdded && (
        <p className="flex items-center gap-3 text-sm" data-testid="add-to-cart-success" role="status">
          <span className="text-in-stock">{t('Product.addedToCart')}</span>
          <Link className="text-primary underline underline-offset-4" href="/cart">
            {t('Product.viewCart')}
          </Link>
        </p>
      )}
    </form>
  );
}

/**
 * Maps the domain's CTA `kind` to copy. The domain deliberately returns
 * semantics rather than a label, so this mapping — and its translations — live
 * in the UI where they belong.
 */
function ctaLabel(
  kind: CtaState['kind'] | undefined, isSubmitting: boolean,
  // Passed in, not read from a hook: this is a plain helper, and calling
  // `useTranslations(, t)` here violates the rules of hooks.
  t: ReturnType<typeof useTranslations>,
): string {
  if (isSubmitting) {
    return t('Product.addingToCart');
  }

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

function VariantPrice({ price, stale }: { price: VariantSnapshot['price']; stale: boolean }) {
  const activeLocale = useLocale();

  if (!price) {
    return null;
  }

  const money = (value: { inc: number; ex: number; currencyCode: string }) =>
    formatCurrencyIn(activeLocale, price.mode === 'INC' ? value.inc : value.ex, value.currencyCode);

  return (
    <p
      className={cn('text-2xl font-semibold', stalenessClasses(stale))}
      // Hidden by CSS when a price overlay renders alongside it — see
      // `styles/globals.css`. Without that a shopper on EUR sees both the
      // prerendered $80.00 and the converted €77.75 at once.
      data-price-base
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

interface Derived {
  cta: CtaState | null;
  stock: ReturnType<typeof toStockDisplay>;
  backorder: ReturnType<typeof toBackorderDisplay>;
  outOfStockMessage: string | null;
}

function VariantAvailability({ derived, stale }: { derived: Derived; stale: boolean }) {
  const t = useTranslations();

  const { stock, backorder, outOfStockMessage } = derived;

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
