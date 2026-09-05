import { describe, it, expect } from 'vitest';
import {
  computeDayMarks,
  businessDateKey,
  overlapWithShiftWindow,
  timeToSeconds,
  isSecondSaturdayKey,
  type AttendanceRules,
  type SessionInput,
} from './attendance-rules';

const RULES: AttendanceRules = {
  workingDays: [1, 2, 3, 4, 5, 6], // Mon–Sat
  lateThreshold: '09:15',
  workStart: '09:00',
  workEnd: '18:00',
  halfDayUnderHours: 4,
  overtimeOverHours: 9,
  idleMinutes: 5,
  threeLatesDeduction: { lateCount: 3, halfDayDeduction: 1 },
  timezone: 'Asia/Kolkata',
  secondSaturdayOff: true,
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

  it('accrues overtime only for time worked past the shift-end boundary (workEnd)', () => {
    // check-in 09:00 IST, check-out 20:00 IST (8pm) → regular 09:00–18:00 (9h), overtime 18:00–20:00 (2h)
    const marks = computeDayMarks([session(3, 30, 14, 30)], RULES, 1);
    expect(marks.workedSeconds).toBe(9 * 3600);
    expect(marks.overtimeSeconds).toBe(2 * 3600);
  });

  it('does not count early arrival as overtime — it is just normal work', () => {
    // check-in 07:00 IST (2h early), check-out 18:00 IST → all 11h is regular, no overtime
    const marks = computeDayMarks([session(1, 30, 12, 30)], RULES, 1);
    expect(marks.workedSeconds).toBe(11 * 3600);
    expect(marks.overtimeSeconds).toBe(0);
  });

  it('an open session live-accrues overtime once it crosses workEnd', () => {
    // checked in 09:00 IST, still open at "now" = 19:00 IST (1h past 18:00 workEnd)
    const nowPastWorkEnd = utc(13, 30); // 19:00 IST
    const marks = computeDayMarks(
      [{ checkInAt: utc(3, 30), checkOutAt: nowPastWorkEnd, idleSeconds: 0 }],
      RULES,
      1,
    );
    expect(marks.workedSeconds).toBe(9 * 3600);
    expect(marks.overtimeSeconds).toBe(1 * 3600);
  });
});

describe('weekly off + idle (§5.3)', () => {
  it('never marks a non-working weekday late, and credits work done on it', () => {
    const marks = computeDayMarks([session(3, 50, 10, 50)], RULES, 0); // Sunday
    expect(marks.isLate).toBe(false);
    // Worked on a Sunday: the day is still not owed, but the hours are credited.
    expect(marks.status).toBe('PRESENT');
  });

  it('marks an unworked non-working weekday WEEKLY_OFF', () => {
    const marks = computeDayMarks([], RULES, 0); // Sunday, no sessions
    expect(marks.status).toBe('WEEKLY_OFF');
    expect(marks.isLate).toBe(false);
  });

  it('surfaces accrued idle seconds', () => {
    const marks = computeDayMarks([session(3, 30, 11, 30, 600)], RULES, 1);
    expect(marks.idleSeconds).toBe(600);
  });
});

describe('overlapWithShiftWindow — idle only counts inside 09:00–18:00 (§4)', () => {
  // IST = UTC+5:30 → 09:00 IST = 03:30 UTC, 18:00 IST = 12:30 UTC.
  it('gap fully inside the shift counts in full', () => {
    expect(overlapWithShiftWindow(utc(5, 0), utc(6, 0), RULES)).toBe(3600); // 10:30–11:30 IST
  });

  it('gap straddling 18:00 only counts the part before 18:00', () => {
    expect(overlapWithShiftWindow(utc(12, 0), utc(14, 0), RULES)).toBe(1800); // 17:30–19:30 IST → 30min
  });

  it('gap fully after 18:00 counts nothing (late stay is own time)', () => {
    expect(overlapWithShiftWindow(utc(13, 0), utc(16, 0), RULES)).toBe(0); // 18:30–21:30 IST
  });

  it('gap straddling 09:00 only counts the part after 09:00', () => {
    expect(overlapWithShiftWindow(utc(2, 30), utc(4, 30), RULES)).toBe(3600); // 08:00–10:00 IST → 1h
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

describe('2nd Saturday off', () => {
  it('identifies only the 2nd Saturday of a month', () => {
    // Aug 2026 Saturdays: 1, 8, 15, 22, 29
    expect(isSecondSaturdayKey('2026-08-01')).toBe(false);
    expect(isSecondSaturdayKey('2026-08-08')).toBe(true);
    expect(isSecondSaturdayKey('2026-08-15')).toBe(false);
    // Sep 2026 Saturdays: 5, 12, 19, 26
    expect(isSecondSaturdayKey('2026-09-12')).toBe(true);
    // A weekday inside the 8–14 window is not a 2nd Saturday
    expect(isSecondSaturdayKey('2026-08-10')).toBe(false);
  });

  it('marks a 2nd Saturday WEEKLY_OFF instead of ABSENT when nobody checks in', () => {
    // Saturday 2026-08-08, no sessions: without the rule this would be ABSENT.
    const marks = computeDayMarks([], RULES, 6, '2026-08-08');
    expect(marks.status).toBe('WEEKLY_OFF');
  });

  it('still treats other Saturdays as normal working days', () => {
    const marks = computeDayMarks([], RULES, 6, '2026-08-15');
    expect(marks.status).toBe('ABSENT');
  });

  it('does not raise a late flag on a 2nd Saturday', () => {
    const late: SessionInput = {
      checkInAt: new Date('2026-08-08T06:00:00Z'), // 11:30 IST — well past 09:15
      checkOutAt: new Date('2026-08-08T12:00:00Z'),
      idleSeconds: 0,
    };
    const marks = computeDayMarks([late], RULES, 6, '2026-08-08');
    expect(marks.isLate).toBe(false);
    // Worked the 2nd Saturday: credited, not erased.
    expect(marks.status).toBe('PRESENT');
  });
});

describe('company holidays', () => {
  const HOL = new Set(['2026-09-14']); // Ganesh Chaturthi, a Monday

  it('marks a holiday WEEKLY_OFF when nobody worked it', () => {
    const marks = computeDayMarks([], RULES, 1, '2026-09-14', HOL);
    expect(marks.status).toBe('WEEKLY_OFF');
  });

  it('does not raise a late flag on a holiday', () => {
    const late: SessionInput = {
      checkInAt: new Date('2026-09-14T06:00:00Z'), // 11:30 IST — well past 09:15
      checkOutAt: new Date('2026-09-14T12:00:00Z'),
      idleSeconds: 0,
    };
    expect(computeDayMarks([late], RULES, 1, '2026-09-14', HOL).isLate).toBe(false);
  });

  it('credits PRESENT to someone who works a full day ON the holiday', () => {
    const full: SessionInput = {
      checkInAt: new Date('2026-09-14T03:30:00Z'), // 09:00 IST
      checkOutAt: new Date('2026-09-14T12:30:00Z'), // 18:00 IST — 9h
      idleSeconds: 0,
    };
    const marks = computeDayMarks([full], RULES, 1, '2026-09-14', HOL);
    expect(marks.status).toBe('PRESENT');
    expect(marks.workedSeconds).toBe(9 * 3600);
  });

  it('credits HALF_DAY to someone who works a short day on the holiday', () => {
    const short: SessionInput = {
      checkInAt: new Date('2026-09-14T03:30:00Z'), // 09:00 IST
      checkOutAt: new Date('2026-09-14T06:00:00Z'), // 11:30 IST — 2.5h
      idleSeconds: 0,
    };
    expect(computeDayMarks([short], RULES, 1, '2026-09-14', HOL).status).toBe('HALF_DAY');
  });

  it('credits work done on a 2nd Saturday too', () => {
    const worked: SessionInput = {
      checkInAt: new Date('2026-08-08T03:30:00Z'),
      checkOutAt: new Date('2026-08-08T12:30:00Z'),
      idleSeconds: 0,
    };
    expect(computeDayMarks([worked], RULES, 6, '2026-08-08').status).toBe('PRESENT');
  });

  it('leaves an ordinary day unaffected by the holiday set', () => {
    expect(computeDayMarks([], RULES, 1, '2026-09-21', HOL).status).toBe('ABSENT');
  });
});
