import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { ClamavService } from '../storage/clamav.service';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * Virus-scan pipeline (Spec §5.6). A version stays unavailable until it scans clean.
 * Infected → quarantined (object removed, status INFECTED), uploader + PM notified,
 * audit entry written. Other versions of the same file are unaffected.
 */
@Injectable()
export class ScanService {
  private readonly logger = new Logger(ScanService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly clamav: ClamavService,
    private readonly notifications: NotificationsService,
  ) {}

  async scan(versionId: string): Promise<void> {
    const version = await this.prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: {
        id: true,
        storageKey: true,
        originalName: true,
        uploadedById: true,
        fileAsset: { select: { task: { select: { title: true, project: { select: { pmId: true } } } } } },
      },
    });
    if (!version) return;

    await this.prisma.fileVersion.update({ where: { id: versionId }, data: { scanStatus: 'SCANNING' } });

    let result;
    try {
      const stream = await this.storage.getObjectStream(version.storageKey);
      result = await this.clamav.scanStream(stream);
    } catch (err) {
      // Transient (clamd down, storage hiccup) — mark ERROR and rethrow so BullMQ retries.
      await this.prisma.fileVersion.update({ where: { id: versionId }, data: { scanStatus: 'ERROR' } });
      this.logger.error(`Scan failed for version ${versionId}: ${(err as Error).message}`);
      throw err;
    }

    if (result.clean) {
      await this.prisma.fileVersion.update({ where: { id: versionId }, data: { scanStatus: 'AVAILABLE', scanDetail: null } });
      return;
    }

    // Infected → quarantine (Spec §5.6).
    await this.prisma.fileVersion.update({
      where: { id: versionId },
      data: { scanStatus: 'INFECTED', scanDetail: result.signature ?? 'infected' },
    });
    await this.storage.remove(version.storageKey); // pull the object so it can never be served

    await this.audit.record({
      action: 'FILE_QUARANTINED',
      entityType: 'FileVersion',
      entityId: versionId,
      after: { signature: result.signature ?? 'infected', name: version.originalName },
    });

    const pmId = version.fileAsset.task?.project?.pmId ?? null;
    await this.notifications.notifyMany([version.uploadedById, pmId], {
      type: 'FILE_QUARANTINED',
      eventGroup: 'files',
      title: 'A file was quarantined',
      body: `"${version.originalName}" was flagged by virus scan (${result.signature ?? 'infected'}) and removed.`,
      entityType: 'FileVersion',
      entityId: versionId,
    });
    this.logger.warn(`Quarantined version ${versionId} (${result.signature ?? 'infected'})`);
  }

  /** Daily cleanup of orphaned partial uploads never finalized (Spec §25). */
  async cleanupOrphans(olderThanHours = 24): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanHours * 3600 * 1000);
    const orphans = await this.prisma.fileVersion.findMany({
      where: { scanStatus: 'PENDING', uploadedAt: { lt: cutoff } },
      select: { id: true, storageKey: true },
    });
    for (const o of orphans) {
      await this.storage.remove(o.storageKey);
      await this.prisma.fileVersion.update({ where: { id: o.id }, data: { scanStatus: 'ERROR', deletedAt: new Date() } });
    }
    if (orphans.length) this.logger.log(`Cleaned up ${orphans.length} orphaned partial upload(s)`);
    return orphans.length;
  }
}
