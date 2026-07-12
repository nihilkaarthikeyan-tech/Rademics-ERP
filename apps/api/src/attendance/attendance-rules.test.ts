import { describe, it, expect } from 'vitest';
import {
  computeDayMarks,
  businessDateKey,
  timeToSeconds,
  type AttendanceRules,
  type SessionInput,
} from './attendance-rules';

const RULES: AttendanceRules = {
  workingDays: [1, 2, 3, 4, 5, 6], // Mon–Sat
  lateThreshold: '09:15',
  halfDayUnderHours: 4,
  overtimeOverHours: 9,
  idleMinutes: 5,
  threeLatesDeduction: { lateCount: 3, halfDayDeduction: 1 },
  timezone: 'Asia/Kolkata',
};

// IST is UTC+5:30. 09:00 IST = 03:30 UTC; 09:20 IST = 03:50 UTC.
const utc = (h: number, m: number) => new Date(Date.UTC(2026, 6, 6, h, m, 0)); // 2026-07-06 is a Monday
const session = (inH: number, inM: number, outH: number, outM: number, idle = 0): SessionInput => ({
  checkInAt: utc(inH, inM),
  checkOutAt: utc(outH, outM),
  idleSeconds: idle,
});

describe('attendance rules — multi-session sum (§5.3)', () => {
  it('sums two sessions in one day', () => {
    // 03:30–06:30 UTC (3h) + 07:30–11:30 UTC (4h) = 7h
    const marks = computeDayMarks([session(3, 30, 6, 30), session(7, 30, 11, 30)], RULES, 1);
    expect(marks.workedSeconds).toBe(7 * 3600);
    expect(marks.status).toBe('PRESENT');
  });

  it('an open session contributes zero until closed', () => {
    const marks = computeDayMarks(
      [{ checkInAt: utc(3, 30), checkOutAt: null, idleSeconds: 0 }],
      RULES,
      1,
    );
    expect(marks.workedSeconds).toBe(0);
    expect(marks.status).toBe('ABSENT');
  });
});

describe('late / half-day / overtime (§4)', () => {
  it('flags late when first check-in is after the threshold (company tz)', () => {
    // check-in 03:50 UTC = 09:20 IST > 09:15 → late
    const marks = computeDayMarks([session(3, 50, 10, 50)], RULES, 1);
    expect(marks.isLate).toBe(true);
  });

  it('does not flag late when on time', () => {
    // check-in 03:30 UTC = 09:00 IST < 09:15 → on time
    const marks = computeDayMarks([session(3, 30, 10, 30)], RULES, 1);
    expect(marks.isLate).toBe(false);
  });

  it('half-day when worked under the configured hours', () => {
    const marks = computeDayMarks([session(3, 30, 6, 0)], RULES, 1); // 2.5h < 4h
    expect(marks.status).toBe('HALF_DAY');
  });

  it('accrues overtime beyond the threshold', () => {
    const marks = computeDayMarks([session(3, 30, 14, 30)], RULES, 1); // 11h worked
    expect(marks.overtimeSeconds).toBe(2 * 3600); // 11h − 9h
  });
});

describe('weekly off + idle (§5.3)', () => {
  it('marks a non-working weekday as WEEKLY_OFF and never late', () => {
    const marks = computeDayMarks([session(3, 50, 10, 50)], RULES, 0); // Sunday
    expect(marks.status).toBe('WEEKLY_OFF');
    expect(marks.isLate).toBe(false);
  });

  it('surfaces accrued idle seconds', () => {
    const marks = computeDayMarks([session(3, 30, 11, 30, 600)], RULES, 1);
    expect(marks.idleSeconds).toBe(600);
  });
});

describe('helpers', () => {
  it('timeToSeconds parses HH:MM', () => {
    expect(timeToSeconds('09:15')).toBe(9 * 3600 + 15 * 60);
  });

  it('businessDateKey reflects the company timezone', () => {
    // 2026-07-06 20:00 UTC = 2026-07-07 01:30 IST → next day in IST
    expect(businessDateKey(new Date(Date.UTC(2026, 6, 6, 20, 0)), 'Asia/Kolkata')).toBe('2026-07-07');
  });
});
