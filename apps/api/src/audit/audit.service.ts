import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { AuditQueryDto } from './dto';

export interface AuditEntry {
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Append-only audit trail (Spec §5.10, §10).
 *
 * Writes are append-only: there is deliberately no update or delete method — no
 * role, including Super Admin, may modify or remove entries. `list()` is a
 * read-only view gated at the controller by audit.log.view (Super Admin only).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: entry.actorId ?? null,
          actorEmail: entry.actorEmail ?? null,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          before: (entry.before ?? undefined) as never,
          after: (entry.after ?? undefined) as never,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (err) {
      // Never let an audit failure break the user action, but do surface it loudly.
      this.logger.error(`Failed to write audit entry for action "${entry.action}"`, err as Error);
    }
  }

  /** Paginated, filtered read of the trail (Spec §5.10). Newest first. */
  async list(query: AuditQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const where: Prisma.AuditLogWhereInput = {};
    if (query.action) where.action = { contains: query.action, mode: 'insensitive' };
    if (query.entityType) where.entityType = query.entityType;
    if (query.actorEmail) where.actorEmail = { contains: query.actorEmail, mode: 'insensitive' };
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      };
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          actorEmail: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
          // IP is still recorded (`record()` above) for genuine security investigation
          // via direct server access, but deliberately never returned through this
          // API/UI — 2026-07-24 decision: nobody views IPs through the app, any role.
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, pageSize };
  }
}
