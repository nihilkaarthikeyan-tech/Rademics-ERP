import { Injectable, Logger } from '@nestjs/common';
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';

export interface RetentionResult {
  notificationsDeleted: number;
  notificationCutoff: string;
  monitoringSessionsDeleted: number;
  monitoringCutoff: string;
}

/**
 * Data-retention hard-deletes (Spec §4, §10, §25).
 *
 * V1 hard-deletes nothing user-facing EXCEPT via these retention jobs (§25 deletion
 * policy): old in-app notifications and granular attendance-monitoring data. Both
 * windows are config-driven (Admin Settings §4) — never hardcoded here. Every purge
 * writes an audit entry ("deletion logged" — §10, Spec line 372).
 *
 * The 12-month "monitoring data" is the granular per-session idle/activity trail
 * (AttendanceSession). The nightly-computed daily aggregates (AttendanceDay) that
 * payroll and reports read are RETAINED — only the surveillance-grade detail is purged
 * (Spec §4 "Idle/activity logs kept 12 months, then purged"; §5.10 audit log is
 * append-only and is never touched by retention).
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
  ) {}

  private async ruleNumber(key: keyof typeof DEFAULT_BUSINESS_RULES, fallback: number): Promise<number> {
    const rules = await this.settings.getBusinessRules();
    const raw = rules[key as string];
    const n = typeof raw === 'number' ? raw : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  }

  /** Delete in-app notifications older than the configured window (default 90 days, §25). */
  async purgeNotifications(): Promise<{ deleted: number; cutoff: Date }> {
    const days = await this.ruleNumber(
      'inAppNotificationRetentionDays',
      DEFAULT_BUSINESS_RULES.inAppNotificationRetentionDays,
    );
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.notification.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) {
      await this.audit.record({
        action: 'RETENTION_NOTIFICATION_PURGE',
        entityType: 'Notification',
        after: { deleted: count, olderThanDays: days, cutoff: cutoff.toISOString() },
      });
    }
    return { deleted: count, cutoff };
  }

  /** Delete granular attendance-monitoring sessions older than the configured window (default 12 months, §4). */
  async purgeMonitoringData(): Promise<{ deleted: number; cutoff: Date }> {
    const months = await this.ruleNumber(
      'monitoringRetentionMonths',
      DEFAULT_BUSINESS_RULES.monitoringRetentionMonths,
    );
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - months);
    const { count } = await this.prisma.attendanceSession.deleteMany({
      where: { checkInAt: { lt: cutoff } },
    });
    if (count > 0) {
      await this.audit.record({
        action: 'RETENTION_MONITORING_PURGE',
        entityType: 'AttendanceSession',
        after: { deleted: count, olderThanMonths: months, cutoff: cutoff.toISOString() },
      });
    }
    return { deleted: count, cutoff };
  }

  /** Run every retention purge — the daily job and the admin on-demand trigger both call this. */
  async runAll(): Promise<RetentionResult> {
    const notifications = await this.purgeNotifications();
    const monitoring = await this.purgeMonitoringData();
    this.logger.log(
      `Retention purge: ${notifications.deleted} notification(s), ${monitoring.deleted} monitoring session(s)`,
    );
    return {
      notificationsDeleted: notifications.deleted,
      notificationCutoff: notifications.cutoff.toISOString(),
      monitoringSessionsDeleted: monitoring.deleted,
      monitoringCutoff: monitoring.cutoff.toISOString(),
    };
  }
}
