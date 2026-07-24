/**
 * Pure attendance rule computation (Spec §5.3, §4). No I/O — everything here is a
 * function of the day's sessions + the configured business rules, so it is unit
 * tested directly. Times are stored UTC (§6 cross-cutting); wall-clock rules
 * (late threshold, working days) are evaluated in the company timezone.
 */

export type AttendanceDayStatus = 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'WEEKLY_OFF' | 'ON_LEAVE';

/** The attendance-relevant slice of the business rules (Spec §4). */
export interface AttendanceRules {
  workingDays: number[]; // JS weekday numbers, 0=Sun … 6=Sat (default Mon–Sat = [1..6])
  lateThreshold: string; // 'HH:MM' in company tz
  workEnd: string; // 'HH:MM' in company tz — the shift-end boundary for overtime (§4)
  halfDayUnderHours: number;
  overtimeOverHours: number;
  idleMinutes: number;
  threeLatesDeduction: { lateCount: number; halfDayDeduction: number };
  timezone: string; // IANA, e.g. 'Asia/Kolkata'
}

export interface SessionInput {
  checkInAt: Date;
  checkOutAt: Date | null;
  idleSeconds: number;
}

export interface DayMarks {
  workedSeconds: number;
  idleSeconds: number;
  overtimeSeconds: number;
  firstCheckInAt: Date | null;
  isLate: boolean;
  status: AttendanceDayStatus;
}

interface ZonedParts {
  year: number;
  month: number; // 1–12
  day: number;
  weekday: number; // 0=Sun … 6=Sat
  secondsOfDay: number;
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/** Wall-clock parts of `date` in the given IANA timezone (dependency-free). */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = fmt.formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '0';
  const hour = Number(get('hour')) % 24; // Intl can emit '24' at midnight
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: WEEKDAY_INDEX[get('weekday')] ?? 0,
    secondsOfDay: hour * 3600 + Number(get('minute')) * 60 + Number(get('second')),
  };
}

/** 'YYYY-MM-DD' business date of `date` in the company timezone. */
export function businessDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  const mm = String(p.month).padStart(2, '0');
  const dd = String(p.day).padStart(2, '0');
  return `${p.year}-${mm}-${dd}`;
}

/** 'HH:MM' (or 'HH:MM:SS') → seconds since local midnight. */
export function timeToSeconds(hhmm: string): number {
  const [h = '0', m = '0', s = '0'] = hhmm.split(':');
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/**
 * The UTC instant of 23:59:59 on the local calendar day that `instant` falls in.
 * Used to auto-close sessions at end-of-day (Spec §5.3). Assumes the tz offset is
 * stable across the day (true for India — no DST).
 */
export function endOfLocalDayUtc(instant: Date, timeZone: string): Date {
  const p = zonedParts(instant, timeZone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) + p.secondsOfDay * 1000;
  const offsetMs = localAsUtc - instant.getTime();
  const endLocalAsUtc = Date.UTC(p.year, p.month - 1, p.day, 23, 59, 59);
  return new Date(endLocalAsUtc - offsetMs);
}

/** JS weekday (0=Sun … 6=Sat) of a 'YYYY-MM-DD' local date. */
export function weekdayOfLocalDate(dateKey: string, timeZone: string): number {
  // Noon UTC stays on the same calendar day for India-like offsets.
  return zonedParts(new Date(`${dateKey}T12:00:00Z`), timeZone).weekday;
}

/**
 * The UTC instant of `hhmm` local time on the same calendar day (in `timeZone`)
 * that `instant` falls on. Used to find the shift-end boundary for a session.
 */
export function localTimeInstantUtc(instant: Date, timeZone: string, hhmm: string): Date {
  const p = zonedParts(instant, timeZone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) + p.secondsOfDay * 1000;
  const offsetMs = localAsUtc - instant.getTime();
  const targetLocalAsUtc = Date.UTC(p.year, p.month - 1, p.day, 0, 0, 0) + timeToSeconds(hhmm) * 1000;
  return new Date(targetLocalAsUtc - offsetMs);
}

/**
 * Splits one session into regular vs. overtime seconds at the configured shift-end
 * boundary (Spec §4, 2026-07-21 decision): only time worked PAST `rules.workEnd`
 * counts as overtime — arriving early doesn't earn or lose anything, it's just
 * normal work. The boundary is anchored to the check-in's calendar day, so a
 * session still open right now (checkOutAt substituted with "now" by the caller)
 * naturally reports live overtime once it crosses that boundary.
 */
function splitSessionSeconds(s: SessionInput, rules: AttendanceRules): { regular: number; overtime: number } {
  if (!s.checkOutAt) return { regular: 0, overtime: 0 }; // still open — not counted until closed/auto-closed
  const start = s.checkInAt;
  const end = s.checkOutAt;
  if (end <= start) return { regular: 0, overtime: 0 };

  const workEndInstant = localTimeInstantUtc(start, rules.timezone, rules.workEnd);

  const regularEnd = end < workEndInstant ? end : workEndInstant;
  const regular = Math.max(0, Math.round((regularEnd.getTime() - start.getTime()) / 1000));

  const overtimeStart = start > workEndInstant ? start : workEndInstant;
  const overtime = Math.max(0, Math.round((end.getTime() - overtimeStart.getTime()) / 1000));

  return { regular, overtime };
}

/**
 * Compute a day's marks from its sessions. `weekday` is derived from the day's
 * business date (passed in so the caller controls which calendar day this is).
 */
export function computeDayMarks(
  sessions: SessionInput[],
  rules: AttendanceRules,
  weekday: number,
): DayMarks {
  const isWorkingDay = rules.workingDays.includes(weekday);

  const splits = sessions.map((s) => splitSessionSeconds(s, rules));
  const workedSeconds = splits.reduce((sum, x) => sum + x.regular, 0);
  const overtimeSeconds = splits.reduce((sum, x) => sum + x.overtime, 0);
  const idleSeconds = sessions.reduce((sum, s) => sum + Math.max(0, s.idleSeconds), 0);

  const firstCheckInAt = sessions.reduce<Date | null>((earliest, s) => {
    if (!earliest || s.checkInAt < earliest) return s.checkInAt;
    return earliest;
  }, null);

  let isLate = false;
  if (isWorkingDay && firstCheckInAt) {
    const localSeconds = zonedParts(firstCheckInAt, rules.timezone).secondsOfDay;
    isLate = localSeconds > timeToSeconds(rules.lateThreshold);
  }

  let status: AttendanceDayStatus;
  if (!isWorkingDay) {
    status = 'WEEKLY_OFF';
  } else if (sessions.length === 0 || workedSeconds === 0) {
    status = 'ABSENT';
  } else if (workedSeconds < rules.halfDayUnderHours * 3600) {
    status = 'HALF_DAY';
  } else {
    status = 'PRESENT';
  }

  return { workedSeconds, idleSeconds, overtimeSeconds, firstCheckInAt, isLate, status };
}
