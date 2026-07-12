/**
 * Pure leave helpers (Spec §5.7, §4). No DB, no time zone surprises: leave dates are
 * whole calendar dates (@db.Date), so all arithmetic is on UTC-midnight day keys.
 */
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';

export type LeaveTypeKey = 'CASUAL' | 'SICK' | 'EARNED' | 'UNPAID';
export type LeaveHalfKey = 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';

export interface LeaveQuota {
  daysPerYear: number;
  accrualPerMonth: number;
  carryForward: boolean;
  carryForwardCap: number;
}

export interface LeaveConfig {
  workingDays: number[]; // ISO weekday numbers that are working days (1=Mon..7=Sun)
  quotas: Record<'CASUAL' | 'SICK' | 'EARNED', LeaveQuota>;
  escalationHours: number;
}

const DEFAULT_LEAVE = DEFAULT_BUSINESS_RULES.leave;

/** Read the leave-relevant slice of Admin Settings, falling back to §4 defaults. */
export function toLeaveConfig(rules: Record<string, unknown>): LeaveConfig {
  const leave = (rules.leave as Record<string, LeaveQuota> | undefined) ?? {};
  const quota = (k: 'casual' | 'sick' | 'earned'): LeaveQuota => ({
    daysPerYear: leave[k]?.daysPerYear ?? DEFAULT_LEAVE[k].daysPerYear,
    accrualPerMonth: leave[k]?.accrualPerMonth ?? DEFAULT_LEAVE[k].accrualPerMonth,
    carryForward: leave[k]?.carryForward ?? DEFAULT_LEAVE[k].carryForward,
    carryForwardCap: leave[k]?.carryForwardCap ?? DEFAULT_LEAVE[k].carryForwardCap,
  });
  return {
    workingDays: (rules.workingDays as number[]) ?? [...DEFAULT_BUSINESS_RULES.workingDays],
    quotas: { CASUAL: quota('casual'), SICK: quota('sick'), EARNED: quota('earned') },
    escalationHours: (rules.leaveEscalationHours as number) ?? DEFAULT_BUSINESS_RULES.leaveEscalationHours,
  };
}

/** 'YYYY-MM-DD' for a Date, in UTC (dates are stored tz-free at UTC midnight). */
export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Parse a 'YYYY-MM-DD' string to a UTC-midnight Date. */
export function parseDateOnly(s: string): Date {
  return new Date(`${s.slice(0, 10)}T00:00:00.000Z`);
}

/** ISO weekday (1=Mon..7=Sun) for a UTC date. */
export function isoWeekday(d: Date): number {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  return day === 0 ? 7 : day;
}

/** Inclusive list of UTC-midnight dates from `from` to `to`. */
export function eachDate(from: Date, to: Date): Date[] {
  const out: Date[] = [];
  for (let t = from.getTime(); t <= to.getTime(); t += 86_400_000) out.push(new Date(t));
  return out;
}

/**
 * Working-day count for a leave span (Spec §5.7). Full-day span counts each date that
 * is a working weekday and not a holiday as 1; a half-day request (single day only)
 * counts 0.5 when that day is a working day. Weekly-offs and holidays contribute 0.
 */
export function countWorkingDays(
  from: Date,
  to: Date,
  half: LeaveHalfKey,
  workingDays: number[],
  holidayKeys: ReadonlySet<string>,
): number {
  const isWorking = (d: Date) => workingDays.includes(isoWeekday(d)) && !holidayKeys.has(dateKey(d));
  if (half !== 'FULL') {
    // Half-day is a single calendar day (enforced in the DTO/service).
    return isWorking(from) ? 0.5 : 0;
  }
  return eachDate(from, to).reduce((n, d) => n + (isWorking(d) ? 1 : 0), 0);
}

/**
 * Split a requested day-count into paid vs unpaid against the available balance
 * (Spec §5.7 excess auto-converts to Unpaid). UNPAID-type requests are entirely unpaid.
 */
export function splitPaidUnpaid(
  type: LeaveTypeKey,
  totalDays: number,
  availableDays: number,
): { paidDays: number; unpaidDays: number } {
  if (type === 'UNPAID') return { paidDays: 0, unpaidDays: totalDays };
  const paidDays = Math.max(0, Math.min(totalDays, availableDays));
  return { paidDays, unpaidDays: Math.round((totalDays - paidDays) * 100) / 100 };
}

/** 'YYYY-MM' period key for accrual idempotency. */
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
