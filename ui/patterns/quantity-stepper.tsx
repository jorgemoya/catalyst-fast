'use client';

import { cn } from '~/lib/cn';

/**
 * Quantity input.
 *
 * Controlled rather than uncontrolled because the value feeds
 * `toBackorderDisplay`: the split between "ships now" and "backordered" moves
 * with quantity, so asking for 3 when 2 are on hand has to say so *before*
 * submission, not after BigCommerce rejects it.
 *
 * The bounds come from the product's own `minPurchaseQuantity` /
 * `maxPurchaseQuantity`. They are enforced here and again by the zod schema on
 * the server, because the buttons are only advisory — the number input accepts
 * typing, and nothing stops a crafted POST.
 */

interface Props {
  name: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number | null;
  decrementLabel: string;
  incrementLabel: string;
  disabled?: boolean;
}

export function QuantityStepper({
  name,
  label,
  value,
  onChange,
  min,
  max,
  decrementLabel,
  incrementLabel,
  disabled = false,
}: Props) {
  const clamp = (next: number) => Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, next));

  return (
    <div>
      <label className="mb-2 block text-sm font-medium" htmlFor={name}>
        {label}
      </label>

      <div className="inline-flex h-11 items-stretch rounded-(--radius-control) border border-border">
        <StepperButton
          disabled={disabled || value <= min}
          label={decrementLabel}
          onClick={() => onChange(clamp(value - 1))}
        >
          &minus;
        </StepperButton>

        <input
          className="w-14 border-x border-border bg-background text-center text-sm tabular-nums outline-none focus-visible:bg-accent"
          disabled={disabled}
          id={name}
          inputMode="numeric"
          max={max ?? undefined}
          min={min}
          name={name}
          // `onChange` fires per keystroke, so an intermediate empty string or a
          // half-typed number must not be clamped out from under the shopper.
          onChange={(event) => {
            const next = Number(event.target.value);

            if (Number.isFinite(next) && event.target.value !== '') {
              onChange(next);
            }
          }}
          onBlur={(event) => {
            const next = Number(event.target.value);

            onChange(Number.isFinite(next) && event.target.value !== '' ? clamp(next) : min);
          }}
          type="number"
          value={value}
        />

        <StepperButton
          disabled={disabled || (max !== null && value >= max)}
          label={incrementLabel}
          onClick={() => onChange(clamp(value + 1))}
        >
          +
        </StepperButton>
      </div>
    </div>
  );
}

function StepperButton({
  children,
  disabled,
  label,
  onClick,
}: {
  children: React.ReactNode;
  disabled: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-label={label}
      className={cn(
        'w-10 text-lg leading-none transition-colors',
        disabled ? 'cursor-not-allowed text-muted opacity-50' : 'hover:bg-accent',
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
