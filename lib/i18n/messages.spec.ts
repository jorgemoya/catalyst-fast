import { describe, expect, it } from 'vitest';

import { formatDate, formatDateOnly } from './messages';

/**
 * Instants and calendar dates look identical in the type system — both are ISO
 * strings — and must be formatted differently. Getting it wrong is silent and
 * off by one day, for every viewer west of UTC.
 */
describe('date formatting', () => {
  const utcMidnight = '2026-12-24T00:00:00.000Z';

  it('renders a picked calendar date as the day that was picked', () => {
    // Observed live before the fix: the shopper chose 2026-12-24 and the cart
    // line read "Dec 23, 2026" in America/Chicago.
    expect(formatDateOnly(utcMidnight)).toBe('Dec 24, 2026');
  });

  it('is timezone-independent for a date-only value', () => {
    const original = process.env.TZ;

    for (const tz of ['America/Chicago', 'Pacific/Kiritimati', 'Asia/Tokyo', 'UTC']) {
      process.env.TZ = tz;
      expect(formatDateOnly(utcMidnight)).toBe('Dec 24, 2026');
    }

    process.env.TZ = original;
  });

  it('still renders a real instant in the viewer’s timezone', () => {
    // A publish time is a moment, not a calendar day — local is correct there,
    // which is why the two functions exist.
    expect(formatDate('2026-06-15T12:00:00.000Z')).toMatch(/Jun 15, 2026/);
  });
});
