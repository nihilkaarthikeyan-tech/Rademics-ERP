import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Grant } from '@rademics/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CapabilityService } from '../rbac/capability.service';
import type { CreateExpenseDto } from './dto';
import type { AuthUser } from '../auth/auth-user';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

const LOG_CAPABILITY = 'finance.expenses.log';

/** Project expenses (Spec §5.8): PM can log against own projects (SCOPED); Finance/SA any. */
@Injectable()
export class ExpensesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly capabilities: CapabilityService,
  ) {}

  async create(dto: CreateExpenseDto, actor: AuthUser, meta: Meta) {
    const project = await this.prisma.project.findUnique({ where: { id: dto.projectId }, select: { id: true, pmId: true } });
    if (!project) throw new NotFoundException('Project not found');
    await this.assertCanLog(actor, project.pmId);

    const expense = await this.prisma.expense.create({
      data: {
        projectId: dto.projectId,
        category: dto.category.trim(),
        amount: dto.amount,
        spentAt: new Date(dto.spentAt),
        description: dto.description ?? null,
        receiptFileId: dto.receiptFileId ?? null,
        createdById: actor.id,
      },
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, action: 'EXPENSE_LOGGED',
      entityType: 'Expense', entityId: expense.id, after: { projectId: dto.projectId, amount: dto.amount, category: dto.category }, ...meta,
    });
    return expense;
  }

  async listForProject(projectId: string) {
    return this.prisma.expense.findMany({ where: { projectId }, orderBy: { spentAt: 'desc' } });
  }

  private async assertCanLog(actor: AuthUser, projectPmId: string | null): Promise<void> {
    const grant = await this.capabilities.resolveGrant(actor.role, actor.resourceType, LOG_CAPABILITY);
    if (grant === Grant.ALLOW) return; // Finance / Super Admin
    if (grant === Grant.SCOPED) {
      if (projectPmId === actor.id) return; // PM on own project
      throw new ForbiddenException('You can only log expenses on your own projects');
    }
    throw new ForbiddenException('Not permitted to log expenses');
  }
}
