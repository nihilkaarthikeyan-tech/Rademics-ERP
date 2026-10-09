import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Payroll month locks (Spec §5.8). Once Finance locks and exports a month, the
 * figures that fed it must not move: attendance recalculation, approved
 * corrections and leave decisions that touch that month are refused until
 * Finance unlocks it (an unlock is audited with a reason).
 */

/** Every 'YYYY-M' month a date range touches. */
function monthsBetween(from: Date, to: Date): { year: number; month: number }[] {
  const out: { year: number; month: number }[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth() + 1;
  const endY = to.getUTCFullYear();
  const endM = to.getUTCMonth() + 1;
  while (y < endY || (y === endY && m <= endM)) {
    out.push({ year: y, month: m });
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/** True when any month in the range is locked. Dates are business dates at UTC midnight. */
export async function isPayrollLocked(prisma: PrismaService, from: Date, to: Date = from): Promise<boolean> {
  const months = monthsBetween(from, to);
  const locked = await prisma.payrollMonth.count({
    where: { status: 'LOCKED', OR: months.map((x) => ({ year: x.year, month: x.month })) },
  });
  return locked > 0;
}

export async function assertPayrollOpen(prisma: PrismaService, from: Date, to: Date = from): Promise<void> {
  if (await isPayrollLocked(prisma, from, to)) {
    throw new BadRequestException(
      "That month's payroll is locked. Ask Finance to unlock it before making this change.",
    );
  }
}
