import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { StorageService } from '../storage/storage.service';
import {
  DEFAULT_BLOCKED_EXTENSIONS,
  DEFAULT_PRESIGNED_MINUTES,
  DEFAULT_UPLOAD_LIMIT_MB,
  FILE_JOB_SCAN,
  QUEUE_FILES,
  type ScanJobData,
} from './files.constants';
import { anonymizedHandle } from '../common/login-code';
import type { AuthUser } from '../auth/auth-user';
import type { InitUploadDto } from './dto';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}
function sanitize(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\-]+/g, '_').slice(0, 200) || 'file';
}

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly storage: StorageService,
    @InjectQueue(QUEUE_FILES) private readonly queue: Queue<ScanJobData>,
  ) {}

  private async fileRules() {
    const r = (await this.settings.getBusinessRules()) as Record<string, unknown>;
    return {
      maxBytes: ((r.fileUploadLimitMb as number) ?? DEFAULT_UPLOAD_LIMIT_MB) * 1024 * 1024,
      blocked: ((r.blockedExtensions as string[]) ?? DEFAULT_BLOCKED_EXTENSIONS).map((e) => e.toLowerCase()),
      presignedSeconds: ((r.presignedUrlMinutes as number) ?? DEFAULT_PRESIGNED_MINUTES) * 60,
    };
  }

  // ── Begin an upload: validate, create the version row, return a presigned PUT (§5.6) ──
  async initUpload(dto: InitUploadDto, actor: AuthUser) {
    const rules = await this.fileRules();
    const ext = extensionOf(dto.filename);
    if (ext && rules.blocked.includes(ext)) {
      throw new BadRequestException(`Files of type ".${ext}" are not allowed (§24)`);
    }
    if (dto.sizeBytes !== undefined && dto.sizeBytes > rules.maxBytes) {
      throw new BadRequestException(`File exceeds the ${rules.maxBytes / (1024 * 1024)} MB limit (§24)`);
    }

    const fileAsset = await this.resolveAsset(dto, actor);
    const agg = await this.prisma.fileVersion.aggregate({
      where: { fileAssetId: fileAsset.id },
      _max: { versionNumber: true },
    });
    const versionNumber = (agg._max.versionNumber ?? 0) + 1;
    const storageKey = `files/${fileAsset.id}/${randomUUID()}/${sanitize(dto.filename)}`;

    const version = await this.prisma.fileVersion.create({
      data: {
        fileAssetId: fileAsset.id,
        versionNumber,
        storageKey,
        originalName: dto.filename,
        contentType: dto.contentType ?? null,
        sizeBytes: dto.sizeBytes ?? null,
        note: dto.note ?? null,
        uploadedById: actor.id,
        scanStatus: 'PENDING',
      },
    });

    const uploadUrl = await this.storage.presignedUpload(storageKey, rules.presignedSeconds);
    return {
      fileAssetId: fileAsset.id,
      versionId: version.id,
      versionNumber,
      storageKey,
      uploadUrl,
      expiresInSeconds: rules.presignedSeconds,
    };
  }

  // ── Finalize: confirm the object landed, then enqueue the virus scan (§5.6) ──
  async finalize(versionId: string, actor: AuthUser, meta: Meta) {
    const version = await this.prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: { id: true, storageKey: true, scanStatus: true, originalName: true, fileAssetId: true },
    });
    if (!version) throw new NotFoundException('File version not found');

    const stat = await this.storage.stat(version.storageKey);
    if (!stat) throw new BadRequestException('Upload not found in storage — did the PUT complete?');

    await this.prisma.fileVersion.update({
      where: { id: versionId },
      data: { scanStatus: 'SCANNING', sizeBytes: stat.size },
    });
    await this.queue.add(
      FILE_JOB_SCAN,
      { versionId },
      { attempts: 3, backoff: { type: 'exponential', delay: 3000 }, removeOnComplete: 500, removeOnFail: 500 },
    );

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'FILE_UPLOADED',
      entityType: 'FileVersion',
      entityId: versionId,
      after: { name: version.originalName, size: stat.size },
      ...meta,
    });
    return { versionId, scanStatus: 'SCANNING' as const };
  }

  scanStatus(versionId: string) {
    return this.prisma.fileVersion
      .findUnique({ where: { id: versionId }, select: { id: true, scanStatus: true, scanDetail: true } })
      .then((v) => {
        if (!v) throw new NotFoundException('File version not found');
        return v;
      });
  }

  // ── List a task's files (scoped for clients) ──
  async listForTask(taskId: string, user: AuthUser) {
    const isClient = user.role === 'CLIENT';
    const assets = await this.prisma.fileAsset.findMany({
      where: { taskId },
      orderBy: { createdAt: 'desc' },
      include: {
        versions: {
          where: {
            deletedAt: null,
            ...(isClient ? { scanStatus: 'AVAILABLE', visibility: 'CLIENT_VISIBLE' } : {}),
          },
          orderBy: { versionNumber: 'desc' },
          select: {
            id: true, versionNumber: true, originalName: true, sizeBytes: true, contentType: true,
            scanStatus: true, visibility: true, note: true, uploadedAt: true,
            uploadedBy: { select: { id: true, name: true, role: true, loginCode: true } },
          },
        },
      },
    });
    // A client sees an asset only if it has at least one visible+clean version.
    const filtered = assets.filter((a) => !isClient || a.versions.length > 0);
    // Double-blind: a client must never see the worker who uploaded a deliverable —
    // replace the uploader's name with their anonymized handle.
    if (!isClient) return filtered;
    return filtered.map((a) => ({
      ...a,
      versions: a.versions.map((v) => ({
        ...v,
        uploadedBy: v.uploadedBy
          ? {
              id: v.uploadedBy.id,
              name: v.uploadedBy.loginCode
                ? anonymizedHandle(v.uploadedBy.loginCode, v.uploadedBy.role)
                : 'Worker (hidden)',
            }
          : null,
      })),
    }));
  }

  // ── Presigned download — only AVAILABLE versions; clients need CLIENT_VISIBLE (§5.6) ──
  async download(versionId: string, user: AuthUser) {
    const rules = await this.fileRules();
    const v = await this.prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: { storageKey: true, originalName: true, scanStatus: true, visibility: true, deletedAt: true },
    });
    if (!v || v.deletedAt) throw new NotFoundException('File not found');
    if (v.scanStatus !== 'AVAILABLE') {
      throw new ConflictException(
        v.scanStatus === 'INFECTED' ? 'This file was quarantined by virus scan' : 'File is not available yet',
      );
    }
    if (user.role === 'CLIENT' && v.visibility !== 'CLIENT_VISIBLE') {
      throw new NotFoundException('File not found');
    }
    const url = await this.storage.presignedDownload(v.storageKey, rules.presignedSeconds, v.originalName);
    return { url, expiresInSeconds: rules.presignedSeconds };
  }

  // ── Flip visibility (Spec §5.6): requires the §3 permission (gated at controller) + audit ──
  async setVisibility(versionId: string, visibility: 'INTERNAL' | 'CLIENT_VISIBLE', actor: AuthUser, meta: Meta) {
    const v = await this.prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: { id: true, visibility: true },
    });
    if (!v) throw new NotFoundException('File version not found');

    const updated = await this.prisma.fileVersion.update({ where: { id: versionId }, data: { visibility } });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'FILE_VISIBILITY_CHANGED',
      entityType: 'FileVersion',
      entityId: versionId,
      before: { visibility: v.visibility },
      after: { visibility },
      ...meta,
    });
    return { id: updated.id, visibility: updated.visibility };
  }

  // ── Soft-delete a version (§25) — object retained, action audited ──
  async deleteVersion(versionId: string, actor: AuthUser, meta: Meta) {
    const v = await this.prisma.fileVersion.findUnique({ where: { id: versionId }, select: { id: true, deletedAt: true } });
    if (!v) throw new NotFoundException('File version not found');
    if (v.deletedAt) return { id: versionId, deleted: true };

    await this.prisma.fileVersion.update({ where: { id: versionId }, data: { deletedAt: new Date() } });
    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'FILE_DELETED',
      entityType: 'FileVersion',
      entityId: versionId,
      ...meta,
    });
    return { id: versionId, deleted: true };
  }

  private async resolveAsset(dto: InitUploadDto, actor: AuthUser) {
    if (dto.fileAssetId) {
      const asset = await this.prisma.fileAsset.findUnique({ where: { id: dto.fileAssetId }, select: { id: true } });
      if (!asset) throw new NotFoundException('File not found');
      return asset;
    }
    const targets = [dto.taskId, dto.profileUserId].filter(Boolean);
    if (targets.length !== 1) {
      throw new BadRequestException('Provide exactly one target: taskId or profileUserId (or a fileAssetId)');
    }
    if (dto.taskId) {
      const task = await this.prisma.task.count({ where: { id: dto.taskId } });
      if (!task) throw new NotFoundException('Task not found');
    }
    if (dto.profileUserId) {
      const u = await this.prisma.user.count({ where: { id: dto.profileUserId } });
      if (!u) throw new NotFoundException('Profile user not found');
    }
    return this.prisma.fileAsset.create({
      data: {
        taskId: dto.taskId ?? null,
        profileUserId: dto.profileUserId ?? null,
        displayName: dto.filename,
        createdById: actor.id,
      },
      select: { id: true },
    });
  }
}
