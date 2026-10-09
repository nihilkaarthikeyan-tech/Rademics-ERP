import { describe, it, expect } from 'vitest';
import { countWorkingDays } from './leave-rules';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const MON_TO_SAT = [1, 2, 3, 4, 5, 6];

describe('leave day count (§5.7)', () => {
  it('does not charge the 2nd Saturday', () => {
    // Mon 5 Oct – Mon 12 Oct 2026: Sat 10 Oct is the 2nd Saturday, Sun 11 a weekly off.
    expect(countWorkingDays(d('2026-10-05'), d('2026-10-12'), 'FULL', MON_TO_SAT, new Set(), true)).toBe(6);
  });

  it('charges other Saturdays as normal working days', () => {
    // Mon 12 Oct – Sat 17 Oct 2026 (3rd Saturday) = 6 days.
    expect(countWorkingDays(d('2026-10-12'), d('2026-10-17'), 'FULL', MON_TO_SAT, new Set(), true)).toBe(6);
  });

  it('a half day on the 2nd Saturday costs nothing', () => {
    expect(countWorkingDays(d('2026-10-10'), d('2026-10-10'), 'FIRST_HALF', MON_TO_SAT, new Set(), true)).toBe(0);
  });

  it('skips company holidays', () => {
    expect(
      countWorkingDays(d('2026-10-19'), d('2026-10-21'), 'FULL', MON_TO_SAT, new Set(['2026-10-20']), true),
    ).toBe(2);
  });
});
