import { randomUUID } from 'node:crypto';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Queue } from 'bullmq';
import { Grant } from '@rademics/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CapabilityService } from '../rbac/capability.service';
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
    private readonly capabilities: CapabilityService,
    @InjectQueue(QUEUE_FILES) private readonly queue: Queue<ScanJobData>,
  ) {}

  async fileRules() {
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
      select: { id: true, storageKey: true, scanStatus: true, originalName: true, fileAssetId: true, uploadedById: true },
    });
    // Only the uploader completes their own upload — anyone else could force
    // rescans of other people's files by version id.
    if (!version || version.uploadedById !== actor.id) throw new NotFoundException('File version not found');

    const stat = await this.storage.stat(version.storageKey);
    if (!stat) throw new BadRequestException('Upload not found in storage — did the PUT complete?');

    // The size limit was only checked at init, against a number the client
    // supplied — and `sizeBytes` is optional, so omitting it skipped the check
    // entirely. This is the first point where the REAL size is known. Storage
    // shares a host with the database, so an unbounded upload is a disk-space
    // attack on the whole system.
    const rules = await this.fileRules();
    if (stat.size > rules.maxBytes) {
      await this.storage.remove(version.storageKey).catch(() => undefined);
      await this.prisma.fileVersion.update({
        where: { id: versionId },
        data: { scanStatus: 'ERROR', sizeBytes: stat.size },
      });
      throw new BadRequestException(
        `That file is ${Math.round(stat.size / 1_048_576)} MB — the limit is ${Math.round(rules.maxBytes / 1_048_576)} MB.`,
      );
    }

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

  /** The uploader polls this while their file is scanned; nobody else needs it. */
  async scanStatus(versionId: string, actor: AuthUser) {
    const v = await this.prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: { id: true, scanStatus: true, scanDetail: true, uploadedById: true },
    });
    if (!v || v.uploadedById !== actor.id) throw new NotFoundException('File version not found');
    const { uploadedById: _uploader, ...status } = v;
    return status;
  }

  /** Only people who administer staff records may touch someone else's profile files. */
  private async assertMayManagePeople(actor: AuthUser): Promise<void> {
    const grant = await this.capabilities.resolveGrant(
      actor.role,
      actor.resourceType,
      'people.employee.create_edit',
    );
    if (grant === Grant.DENY) {
      throw new ForbiddenException('You can only attach files to your own profile.');
    }
  }

  // ── List a task's files (scoped for clients) ──
  async listForTask(taskId: string, user: AuthUser) {
    await this.assertTaskAccess(taskId, user);
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
            uploadedBy: { select: { id: true, name: true } },
          },
        },
      },
    });
    // A client sees an asset only if it has at least one visible+clean version.
    const visible = assets.filter((a) => !isClient || a.versions.length > 0);
    if (!isClient) return visible;
    // Who uploaded it is internal identity (2026-07-27): a client is not told
    // which individual works on their project. The portal UI never rendered it,
    // but it was in the response body and therefore readable.
    return visible.map((a) => ({
      ...a,
      versions: a.versions.map(({ uploadedBy: _hidden, ...v }) => v),
    }));
  }

  // ── Presigned download — only AVAILABLE versions; clients need CLIENT_VISIBLE (§5.6) ──
  async download(versionId: string, user: AuthUser, inline = false) {
    const rules = await this.fileRules();
    const v = await this.prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: {
        storageKey: true,
        originalName: true,
        scanStatus: true,
        visibility: true,
        deletedAt: true,
        fileAsset: { select: { taskId: true, profileUserId: true, createdById: true, chatMessageId: true } },
      },
    });
    if (!v || v.deletedAt) throw new NotFoundException('File not found');
    // Scope BEFORE handing out a presigned URL — that URL bypasses the API
    // entirely, so this is the last point at which access can be refused.
    if (v.fileAsset.taskId) {
      await this.assertTaskAccess(v.fileAsset.taskId, user);
    } else if (v.fileAsset.profileUserId && v.fileAsset.profileUserId !== user.id) {
      await this.assertMayManagePeople(user);
    } else if (!v.fileAsset.profileUserId && !v.fileAsset.chatMessageId && v.fileAsset.createdById !== user.id) {
      // An attachment still being drafted (not sent to chat or attached to
      // anything yet) is its creator's alone.
      throw new NotFoundException('File not found');
    }
    if (v.scanStatus !== 'AVAILABLE') {
      throw new ConflictException(
        v.scanStatus === 'INFECTED' ? 'This file was quarantined by virus scan' : 'File is not available yet',
      );
    }
    if (user.role === 'CLIENT' && v.visibility !== 'CLIENT_VISIBLE') {
      throw new NotFoundException('File not found');
    }
    const url = await this.storage.presignedDownload(v.storageKey, rules.presignedSeconds, v.originalName, inline);
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

  /**
   * May this person see the files on this task?
   *
   * The same involvement test TasksService.get uses, deliberately duplicated
   * rather than imported (FilesService is a dependency of the projects module,
   * so calling back into it would be circular). Without this, `GET /files?taskId`
   * and the download route were gated only on `files.upload` — held by every
   * employee — so a task id from another project returned its documents and a
   * live presigned URL, while `GET /tasks/:id` correctly refused the task
   * itself. The app 403'd the task and handed over its attachments.
   *
   * Watchership is NOT accepted as involvement here: it can be self-granted.
   */
  private async assertTaskAccess(taskId: string, user: AuthUser): Promise<void> {
    if (['SUPER_ADMIN', 'HR', 'FINANCE'].includes(user.role)) return;
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { assigneeId: true, createdById: true, projectId: true, project: { select: { pmId: true } } },
    });
    if (!task) throw new NotFoundException('File not found');

    if (user.role === 'CLIENT') {
      // Clients reach files through the portal, which checks org access itself.
      const granted = await this.prisma.clientProjectAccess.count({
        where: { projectId: task.projectId, clientUserId: user.id },
      });
      if (!granted) throw new NotFoundException('File not found');
      return;
    }

    const involved =
      task.assigneeId === user.id ||
      task.createdById === user.id ||
      task.project.pmId === user.id ||
      (await this.prisma.task.count({ where: { projectId: task.projectId, assigneeId: user.id } })) > 0;
    if (!involved) throw new NotFoundException('File not found');
  }

  private async resolveAsset(dto: InitUploadDto, actor: AuthUser) {
    if (dto.fileAssetId) {
      // Uploading a NEW VERSION of an existing file is an edit of that file.
      // Existence was the only check, so any employee could add version N+1 to
      // anyone's asset — and the UI shows the newest version.
      const asset = await this.prisma.fileAsset.findUnique({
        where: { id: dto.fileAssetId },
        select: { id: true, taskId: true, profileUserId: true, createdById: true },
      });
      if (!asset) throw new NotFoundException('File not found');
      if (asset.taskId) {
        await this.assertTaskAccess(asset.taskId, actor);
      } else if (asset.profileUserId && asset.profileUserId !== actor.id) {
        await this.assertMayManagePeople(actor);
      } else if (!asset.taskId && !asset.profileUserId && asset.createdById !== actor.id) {
        // An unattached draft belongs to whoever started it (chat attachments).
        throw new NotFoundException('File not found');
      }
      return asset;
    }
    const targets = [dto.taskId, dto.profileUserId].filter(Boolean);
    if (targets.length !== 1) {
      throw new BadRequestException('Provide exactly one target: taskId or profileUserId (or a fileAssetId)');
    }
    if (dto.taskId) {
      const task = await this.prisma.task.count({ where: { id: dto.taskId } });
      if (!task) throw new NotFoundException('Task not found');
      await this.assertTaskAccess(dto.taskId, actor);
    }
    if (dto.profileUserId) {
      const u = await this.prisma.user.count({ where: { id: dto.profileUserId } });
      if (!u) throw new NotFoundException('Profile user not found');
      // Your own profile, or someone whose records you administer. Otherwise an
      // employee could file documents against a colleague's HR profile.
      if (dto.profileUserId !== actor.id) await this.assertMayManagePeople(actor);
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
