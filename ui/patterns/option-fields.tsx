'use client';

import { useTranslations } from 'next-intl';

import type { ProductOptionField } from '~/domain/product-options';
import { cn } from '~/lib/cn';
import { Image } from '~/ui/primitives/image';

/**
 * Renders one product option, for all eleven BigCommerce option types.
 *
 * Split into two groups by how they submit, which mirrors how they behave:
 *
 *  - **Variant-defining** (swatch, boxes, radio, dropdown, both pick lists,
 *    checkbox) are rendered as buttons so selection can be reflected instantly,
 *    and their value rides along in a hidden input. Changing one re-resolves
 *    price and stock.
 *  - **Personalization** (number, text, textarea, date) are plain named inputs,
 *    uncontrolled. They never change what is being bought, so they need no state
 *    and trigger no server round trip — they are simply collected on submit.
 *
 * Every control carries `name="option.<id>"`, which is the nested form
 * `domain/cart-line.ts` builds its schema against.
 */

interface Props {
  field: ProductOptionField;
  /** `option.<id>` — the submitted name. */
  name: string;
  /** Present only for variant-defining fields, which are React-controlled. */
  value?: string;
  onSelect: (value: string) => void;
  errors?: string[];
}

const inputClass =
  'h-10 w-full rounded-(--radius-control) border border-border bg-background px-2 text-sm';

export function OptionField({ field, name, value, onSelect, errors }: Props) {
  const t = useTranslations();

  const label = (
    <span className="mb-2 block text-sm font-medium">
      {field.label}
      {field.required && <span className="text-error"> *</span>}
    </span>
  );

  const messages = errors?.length ? (
    <p className="mt-1 text-sm text-error" id={`${name}-error`}>
      {errors.join(' ')}
    </p>
  ) : null;

  const describedBy = errors?.length ? `${name}-error` : undefined;

  switch (field.type) {
    case 'swatch':
      return (
        <fieldset>
          <legend className="sr-only">{field.label}</legend>
          {label}
          <input name={name} type="hidden" value={value ?? ''} />
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
          {messages}
        </fieldset>
      );

    case 'buttons':
    case 'radio':
    case 'cards':
      return (
        <fieldset>
          <legend className="sr-only">{field.label}</legend>
          {label}
          <input name={name} type="hidden" value={value ?? ''} />
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
          {messages}
        </fieldset>
      );

    case 'select':
      return (
        <div>
          <label htmlFor={name}>{label}</label>
          <select
            aria-describedby={describedBy}
            className={inputClass}
            id={name}
            name={name}
            onChange={(event) => onSelect(event.target.value)}
            required={field.required}
            value={value ?? ''}
          >
            <option value="">{t('Product.chooseOption')}</option>
            {field.values.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {messages}
        </div>
      );

    case 'checkbox':
      return (
        <div>
          {/*
            A native unchecked checkbox submits nothing, but BigCommerce models
            "unchecked" as its own option-value id — so the visible control is
            unnamed and a hidden input carries whichever id is currently selected.
          */}
          <input name={name} type="hidden" value={value ?? field.uncheckedValue} />
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
            {field.required && <span className="text-error"> *</span>}
          </label>
          {messages}
        </div>
      );

    case 'number':
      return (
        <div>
          <label htmlFor={name}>{label}</label>
          <input
            aria-describedby={describedBy}
            className={inputClass}
            defaultValue={field.defaultValue}
            id={name}
            max={field.max}
            min={field.min}
            name={name}
            required={field.required}
            step={field.integerOnly ? 1 : 'any'}
            type="number"
          />
          {messages}
        </div>
      );

    case 'text':
      return (
        <div>
          <label htmlFor={name}>{label}</label>
          <input
            aria-describedby={describedBy}
            className={inputClass}
            defaultValue={field.defaultValue}
            id={name}
            maxLength={field.maxLength}
            minLength={field.minLength}
            name={name}
            required={field.required}
            type="text"
          />
          {messages}
        </div>
      );

    case 'textarea':
      return (
        <div>
          <label htmlFor={name}>{label}</label>
          <textarea
            aria-describedby={describedBy}
            className="w-full rounded-(--radius-control) border border-border bg-background px-2 py-1.5 text-sm"
            defaultValue={field.defaultValue}
            id={name}
            maxLength={field.maxLength}
            minLength={field.minLength}
            name={name}
            required={field.required}
            rows={field.maxLines ?? 3}
          />
          {messages}
        </div>
      );

    case 'date':
      return (
        <div>
          <label htmlFor={name}>{label}</label>
          <input
            aria-describedby={describedBy}
            className={inputClass}
            defaultValue={field.defaultValue}
            id={name}
            max={field.latest}
            min={field.earliest}
            name={name}
            required={field.required}
            type="date"
          />
          {messages}
        </div>
      );

    default:
      return null;
  }
}
