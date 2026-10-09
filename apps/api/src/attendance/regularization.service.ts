import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Grant } from '@rademics/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailProducer } from '../queue/email.producer';
import { pageArgs } from '../common/pagination';
import { CapabilityService } from '../rbac/capability.service';
import { AttendanceService } from './attendance.service';
import { AttendanceComputeService } from './attendance-compute.service';
import { businessDateKey, endOfLocalDayUtc, localTimeInstantUtc, overlapWithShiftWindow } from './attendance-rules';

const HOUR_MS = 3600 * 1000;
import type { AuthUser } from '../auth/auth-user';
import type { CreateRegularizationDto, DecideRegularizationDto } from './dto';
import { escapeHtml } from '../common/escape-html';
import { assertPayrollOpen } from '../common/payroll-lock';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

const APPROVE_CAPABILITY = 'attendance.regularization.approve';

/**
 * Regularization (Spec §5.3): an employee requests a correction with a reason; a
 * Team Lead (or HR if no TL) approves. Approval creates a corrective session and
 * recomputes the day — it NEVER overwrites the original session history.
 */
@Injectable()
export class RegularizationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailProducer,
    private readonly capabilities: CapabilityService,
    private readonly attendance: AttendanceService,
    private readonly compute: AttendanceComputeService,
  ) {}

  // ── Request (Spec §5.3, §24) ──
  async create(user: AuthUser, dto: CreateRegularizationDto, meta: Meta) {
    const date = new Date(dto.date);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Invalid date');
    if (date > new Date()) throw new BadRequestException('Cannot regularize a future date');
    await assertPayrollOpen(this.prisma, date);
    const kind = dto.kind ?? 'CORRECTION';
    if (kind === 'POWER_CUT' && (!dto.requestedCheckInAt || !dto.requestedCheckOutAt)) {
      throw new BadRequestException('Give the time the power cut started and ended');
    }
    // A correction with no times could be approved but would change nothing.
    if (kind === 'CORRECTION' && !dto.requestedCheckInAt && !dto.requestedCheckOutAt) {
      throw new BadRequestException('Give the correct check-in time, check-out time, or both');
    }
    await this.assertWindowFitsDay(dto, kind);

    // No overlapping pending request for the same day (§24).
    const clash = await this.prisma.regularizationRequest.findFirst({
      where: { userId: user.id, date, status: 'PENDING' },
      select: { id: true },
    });
    if (clash) throw new BadRequestException('A pending regularization already exists for this date');

    const req = await this.prisma.regularizationRequest.create({
      data: {
        userId: user.id,
        date,
        reason: dto.reason.trim(),
        kind,
        requestedCheckInAt: dto.requestedCheckInAt ? new Date(dto.requestedCheckInAt) : null,
        requestedCheckOutAt: dto.requestedCheckOutAt ? new Date(dto.requestedCheckOutAt) : null,
      },
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'REGULARIZATION_REQUESTED',
      entityType: 'RegularizationRequest',
      entityId: req.id,
      after: { date: dto.date, kind },
      ...meta,
    });
    await this.notifyApprover(user.id, dto.date);
    this.attendance.announceChange(); // an approver with the page open should see it arrive
    return req;
  }

  // ── Own requests ──
  // One page at a time: a request per correction adds up over years of employment.
  async listMine(user: AuthUser, query?: { page?: number; pageSize?: number }) {
    const { page, pageSize, skip, take } = pageArgs(query);
    const where = { userId: user.id };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.regularizationRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.regularizationRequest.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // ── Pending requests the caller may approve (scoped for TL/PM) ──
  async listPending(caller: AuthUser, query?: { page?: number; pageSize?: number }) {
    const grant = await this.capabilities.resolveGrant(
      caller.role,
      caller.resourceType,
      APPROVE_CAPABILITY,
    );
    // Never your own requests — someone else has to approve those (see assertCanApprove).
    const where =
      grant === Grant.ALLOW
        ? { status: 'PENDING' as const, userId: { not: caller.id } }
        : {
            status: 'PENDING' as const,
            userId: { in: (await this.attendance.teamScopeUserIds(caller.id)).filter((id) => id !== caller.id) },
          };

    const { page, pageSize, skip, take } = pageArgs(query);
    const [items, total] = await this.prisma.$transaction([
      this.prisma.regularizationRequest.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        include: { user: { select: { id: true, name: true, email: true } } },
        skip,
        take,
      }),
      this.prisma.regularizationRequest.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }

  // ── Approve / reject (Spec §5.3) ──
  async decide(id: string, approve: boolean, dto: DecideRegularizationDto, caller: AuthUser, meta: Meta) {
    const req = await this.prisma.regularizationRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Regularization not found');
    if (req.status !== 'PENDING') throw new BadRequestException('Request is already actioned');

    await this.assertCanApprove(caller, req.userId);
    if (approve) await assertPayrollOpen(this.prisma, req.date);

    // Work out the corrective session BEFORE claiming, so a request that can't
    // be applied is refused instead of being marked Approved with no effect.
    const corrective =
      approve && req.kind !== 'POWER_CUT' ? await this.correctiveSession(req) : null;

    // Claim the request atomically before applying anything: two approvers
    // clicking at once would otherwise both pass the PENDING check above and
    // create two corrective sessions (or credit a power cut twice).
    const claimed = await this.prisma.regularizationRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        reviewerId: caller.id,
        decisionComment: dto.comment?.trim() ?? null,
        decidedAt: new Date(),
      },
    });
    if (claimed.count === 0) throw new BadRequestException('Request is already actioned');

    const idleCreditedSeconds =
      approve && req.kind === 'POWER_CUT' && req.requestedCheckInAt && req.requestedCheckOutAt
        ? await this.removeIdleInWindow(req.userId, req.requestedCheckInAt, req.requestedCheckOutAt)
        : null;

    const updated =
      idleCreditedSeconds === null
        ? await this.prisma.regularizationRequest.findUniqueOrThrow({ where: { id } })
        : await this.prisma.regularizationRequest.update({ where: { id }, data: { idleCreditedSeconds } });

    if (idleCreditedSeconds !== null) {
      const rules = await this.attendance.getRules();
      const dayKey = businessDateKey(req.requestedCheckInAt!, rules.timezone);
      await this.compute.computeDay(req.userId, dayKey, rules);
      await this.compute.recomputeLateDeductions(req.userId, dayKey, rules);
    } else if (corrective) {
      // Corrective session — original sessions are untouched (§5.3 "never overwrites");
      // the day's calculation merges overlapping time so nothing is counted twice.
      await this.prisma.attendanceSession.create({
        data: {
          userId: req.userId,
          checkInAt: corrective.checkInAt,
          checkOutAt: corrective.checkOutAt,
          checkInIp: meta.ip ?? null,
          checkInUserAgent: 'regularization',
        },
      });
      const rules = await this.attendance.getRules();
      const dayKey = businessDateKey(req.date, rules.timezone);
      await this.compute.computeDay(req.userId, dayKey, rules);
      await this.compute.recomputeLateDeductions(req.userId, dayKey, rules);
    }

    await this.audit.record({
      actorId: caller.id,
      actorEmail: caller.email,
      action: approve ? 'REGULARIZATION_APPROVED' : 'REGULARIZATION_REJECTED',
      entityType: 'RegularizationRequest',
      entityId: id,
      before: { status: 'PENDING' },
      after: { status: updated.status, comment: dto.comment ?? null, idleCreditedSeconds },
      ...meta,
    });
    await this.notifyRequester(req.userId, approve);
    this.attendance.announceChange();
    return updated;
  }

  // ── helpers ──

  /**
   * The session an approved correction adds. Both times: exactly that span.
   * Only a check-out ("I forgot to check out"): from that day's last check-in
   * before it to the given time. Only a check-in ("I came earlier"): from the
   * given time to the end of that day's first session.
   */
  private async correctiveSession(req: {
    userId: string;
    date: Date;
    requestedCheckInAt: Date | null;
    requestedCheckOutAt: Date | null;
  }): Promise<{ checkInAt: Date; checkOutAt: Date }> {
    const inAt = req.requestedCheckInAt;
    const outAt = req.requestedCheckOutAt;
    if (inAt && outAt) {
      if (outAt <= inAt) throw new BadRequestException('The check-out time must be after the check-in time');
      return { checkInAt: inAt, checkOutAt: outAt };
    }
    if (!inAt && !outAt) {
      throw new BadRequestException('This request has no times to apply. Reject it and ask for the correct times.');
    }
    const rules = await this.attendance.getRules();
    // req.date is the business date at UTC midnight; noon keeps it inside that local day.
    const midday = new Date(req.date.getTime() + 12 * 3600 * 1000);
    const dayStart = localTimeInstantUtc(midday, rules.timezone, '00:00');
    const dayEnd = endOfLocalDayUtc(midday, rules.timezone);
    const sessions = await this.prisma.attendanceSession.findMany({
      where: { userId: req.userId, checkInAt: { gte: dayStart, lte: dayEnd } },
      select: { checkInAt: true, checkOutAt: true },
      orderBy: { checkInAt: 'asc' },
    });
    if (outAt) {
      const anchor = [...sessions].reverse().find((s) => s.checkInAt < outAt);
      if (!anchor) {
        throw new BadRequestException('There is no check-in that day before this check-out time. Ask for the check-in time too.');
      }
      return { checkInAt: anchor.checkInAt, checkOutAt: outAt };
    }
    const first = sessions[0];
    const end = first ? (first.checkOutAt ?? first.checkInAt) : null;
    if (!end || end <= inAt!) {
      throw new BadRequestException('There is no session that day after this check-in time. Ask for the check-out time too.');
    }
    return { checkInAt: inAt!, checkOutAt: end };
  }

  /**
   * The requested times must belong to the day being corrected: the start on
   * that business date, nothing in the future, and no longer than a day (12h
   * for a power cut). Without this a request "for yesterday" could carry a
   * 30-day session, and approving it would pay for all of it.
   */
  private async assertWindowFitsDay(dto: CreateRegularizationDto, kind: 'CORRECTION' | 'POWER_CUT') {
    const from = dto.requestedCheckInAt ? new Date(dto.requestedCheckInAt) : null;
    const to = dto.requestedCheckOutAt ? new Date(dto.requestedCheckOutAt) : null;
    if (!from && !to) return;
    const label = kind === 'POWER_CUT' ? 'power cut' : 'check-in/out';
    const now = new Date();
    if ((from && from > now) || (to && to > now)) {
      throw new BadRequestException(`The ${label} times can't be in the future`);
    }
    const { timezone } = await this.attendance.getRules();
    // A lone check-out is anchored to the day too; a check-out after a check-in
    // may run past midnight (a late shift), bounded by the length limit below.
    const anchor = from ?? to!;
    if (businessDateKey(anchor, timezone) !== dto.date.slice(0, 10)) {
      throw new BadRequestException(`The ${label} times must be on ${dto.date.slice(0, 10)}`);
    }
    if (from && to) {
      if (to <= from) {
        throw new BadRequestException(kind === 'POWER_CUT' ? 'The power cut must end after it starts' : 'Check-out must be after check-in');
      }
      const maxHours = kind === 'POWER_CUT' ? 12 : 24;
      if (to.getTime() - from.getTime() > maxHours * HOUR_MS) {
        throw new BadRequestException(`A ${kind === 'POWER_CUT' ? 'power cut' : 'correction'} can cover at most ${maxHours} hours`);
      }
    }
  }

  /**
   * Cut [from, to] out of the user's recorded idle stretches and take the
   * difference off their sessions' idle. Only idle actually charged inside the
   * window is removed, and a stretch is split rather than shrunk — so the same
   * outage can never be credited twice by a second request. Returns seconds removed.
   */
  private async removeIdleInWindow(userId: string, from: Date, to: Date): Promise<number> {
    const rules = await this.attendance.getRules();
    const gaps = await this.prisma.attendanceIdleGap.findMany({
      where: { userId, startAt: { lt: to }, endAt: { gt: from } },
    });
    const perSession = new Map<string, number>();
    const ops = [];
    for (const g of gaps) {
      const pieces = [
        { startAt: g.startAt, endAt: from < g.startAt ? g.startAt : from },
        { startAt: to > g.endAt ? g.endAt : to, endAt: g.endAt },
      ]
        .map((p) => ({ ...p, seconds: overlapWithShiftWindow(p.startAt, p.endAt, rules) }))
        .filter((p) => p.endAt > p.startAt && p.seconds > 0);
      const kept = pieces.reduce((n, p) => n + p.seconds, 0);
      const removed = Math.max(0, g.seconds - kept);
      if (removed === 0) continue;
      perSession.set(g.sessionId, (perSession.get(g.sessionId) ?? 0) + removed);
      ops.push(this.prisma.attendanceIdleGap.delete({ where: { id: g.id } }));
      if (pieces.length) {
        ops.push(
          this.prisma.attendanceIdleGap.createMany({
            data: pieces.map((p) => ({ ...p, sessionId: g.sessionId, userId })),
          }),
        );
      }
    }
    const sessions = await this.prisma.attendanceSession.findMany({
      where: { id: { in: [...perSession.keys()] } },
      select: { id: true, idleSeconds: true },
    });
    let total = 0;
    for (const s of sessions) {
      const credit = Math.min(s.idleSeconds, perSession.get(s.id) ?? 0);
      total += credit;
      ops.push(
        this.prisma.attendanceSession.update({ where: { id: s.id }, data: { idleSeconds: { decrement: credit } } }),
      );
    }
    await this.prisma.$transaction(ops);
    return total;
  }
  private async assertCanApprove(caller: AuthUser, subjectUserId: string): Promise<void> {
    // HR holds request + approve, and a Team Lead sits inside their own team
    // scope — without this either could approve a correction (a paid day) or
    // a power cut (erased idle) for themselves. Leave has the same rule.
    if (subjectUserId === caller.id) throw new ForbiddenException('You cannot approve your own request');
    const grant = await this.capabilities.resolveGrant(
      caller.role,
      caller.resourceType,
      APPROVE_CAPABILITY,
    );
    if (grant === Grant.ALLOW) return;
    if (grant === Grant.SCOPED) {
      const scope = await this.attendance.teamScopeUserIds(caller.id);
      if (scope.includes(subjectUserId)) return;
      throw new ForbiddenException('Outside your approval scope');
    }
    throw new ForbiddenException('Not permitted to approve regularizations');
  }

  private async notifyApprover(requesterId: string, dateLabel: string): Promise<void> {
    const requester = await this.prisma.user.findUnique({
      where: { id: requesterId },
      select: {
        name: true,
        reportingManager: { select: { email: true } },
        team: { select: { teamLead: { select: { email: true } } } },
      },
    });
    const approverEmail =
      requester?.reportingManager?.email ?? requester?.team?.teamLead?.email ?? null;
    if (!approverEmail) return; // no direct approver — HR picks it up from the pending list

    await this.email.enqueue({
      to: approverEmail,
      subject: 'Attendance regularization awaiting your approval',
      html: `<p>${escapeHtml(requester?.name ?? 'An employee')} requested an attendance regularization for <strong>${dateLabel}</strong>.</p><p>Review it in the Attendance section.</p>`,
      text: `${requester?.name ?? 'An employee'} requested an attendance regularization for ${dateLabel}.`,
    });
  }

  private async notifyRequester(userId: string, approve: boolean): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) return;
    const verb = approve ? 'approved' : 'rejected';
    await this.email.enqueue({
      to: user.email,
      subject: `Your attendance regularization was ${verb}`,
      html: `<p>Your attendance regularization request was <strong>${verb}</strong>.</p>`,
      text: `Your attendance regularization request was ${verb}.`,
    });
  }
}
