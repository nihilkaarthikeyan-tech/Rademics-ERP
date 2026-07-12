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
import { CapabilityService } from '../rbac/capability.service';
import { AttendanceService } from './attendance.service';
import { AttendanceComputeService } from './attendance-compute.service';
import { businessDateKey } from './attendance-rules';
import type { AuthUser } from '../auth/auth-user';
import type { CreateRegularizationDto, DecideRegularizationDto } from './dto';

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
    if (dto.requestedCheckInAt && dto.requestedCheckOutAt) {
      if (new Date(dto.requestedCheckOutAt) <= new Date(dto.requestedCheckInAt)) {
        throw new BadRequestException('Check-out must be after check-in');
      }
    }

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
      after: { date: dto.date },
      ...meta,
    });
    await this.notifyApprover(user.id, dto.date);
    return req;
  }

  // ── Own requests ──
  listMine(user: AuthUser) {
    return this.prisma.regularizationRequest.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Pending requests the caller may approve (scoped for TL/PM) ──
  async listPending(caller: AuthUser) {
    const grant = await this.capabilities.resolveGrant(
      caller.role,
      caller.resourceType,
      APPROVE_CAPABILITY,
    );
    const where =
      grant === Grant.ALLOW
        ? { status: 'PENDING' as const }
        : { status: 'PENDING' as const, userId: { in: await this.attendance.teamScopeUserIds(caller.id) } };

    return this.prisma.regularizationRequest.findMany({
      where,
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  // ── Approve / reject (Spec §5.3) ──
  async decide(id: string, approve: boolean, dto: DecideRegularizationDto, caller: AuthUser, meta: Meta) {
    const req = await this.prisma.regularizationRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Regularization not found');
    if (req.status !== 'PENDING') throw new BadRequestException('Request is already actioned');

    await this.assertCanApprove(caller, req.userId);

    const updated = await this.prisma.regularizationRequest.update({
      where: { id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        reviewerId: caller.id,
        decisionComment: dto.comment?.trim() ?? null,
        decidedAt: new Date(),
      },
    });

    if (approve && req.requestedCheckInAt && req.requestedCheckOutAt) {
      // Corrective session — original sessions are untouched (§5.3 "never overwrites").
      await this.prisma.attendanceSession.create({
        data: {
          userId: req.userId,
          checkInAt: req.requestedCheckInAt,
          checkOutAt: req.requestedCheckOutAt,
          checkInIp: meta.ip ?? null,
          checkInUserAgent: 'regularization',
        },
      });
      const rules = await this.attendance.getRules();
      await this.compute.computeDay(req.userId, businessDateKey(req.date, rules.timezone), rules);
    }

    await this.audit.record({
      actorId: caller.id,
      actorEmail: caller.email,
      action: approve ? 'REGULARIZATION_APPROVED' : 'REGULARIZATION_REJECTED',
      entityType: 'RegularizationRequest',
      entityId: id,
      before: { status: 'PENDING' },
      after: { status: updated.status, comment: dto.comment ?? null },
      ...meta,
    });
    await this.notifyRequester(req.userId, approve);
    return updated;
  }

  // ── helpers ──
  private async assertCanApprove(caller: AuthUser, subjectUserId: string): Promise<void> {
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
      html: `<p>${requester?.name ?? 'An employee'} requested an attendance regularization for <strong>${dateLabel}</strong>.</p><p>Review it in the Attendance section.</p>`,
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
