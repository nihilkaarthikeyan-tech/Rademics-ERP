import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../attendance/presence.service';
import { FilesService } from '../files/files.service';
import type { AuthUser } from '../auth/auth-user';

/** Audit metadata shape produced by reqMeta(). */
type Meta = { ip?: string | null; userAgent?: string | null };

/** What the UI needs to render one attachment: name, size, type, scan state. */
const ATTACHMENT_SELECT = {
  id: true,
  displayName: true,
  versions: {
    orderBy: { versionNumber: 'desc' },
    take: 1,
    select: {
      id: true,
      scanStatus: true,
      sizeBytes: true,
      contentType: true,
      deletedAt: true,
    },
  },
} as const;

type AssetRow = {
  id: string;
  displayName: string;
  versions: {
    id: string;
    scanStatus: string;
    sizeBytes: number | null;
    contentType: string | null;
    deletedAt: Date | null;
  }[];
};

function shapeAttachments(files: AssetRow[]) {
  return files
    .map((f) => {
      const v = f.versions[0];
      if (!v || v.deletedAt) return null;
      return {
        id: f.id,
        versionId: v.id,
        name: f.displayName,
        sizeBytes: v.sizeBytes,
        contentType: v.contentType,
        scanStatus: v.scanStatus,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
}

/**
 * Company chat v1 (2026-07-26): ONE general room every staff member is in.
 * Messages persist here for history and are pushed live over the presence
 * socket ('chat:message'). Unread = messages newer than your read pointer.
 *
 * Attachments reuse the §5.6 file pipeline (presigned upload → ClamAV scan),
 * so a chat file is scanned exactly like a task file and is only downloadable
 * once clean. Chat has its own thin wrappers because the /files routes are
 * gated on files.upload — a capability Finance does not hold, and every staff
 * member must be able to open what was shared in the company room.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly files: FilesService,
  ) {}

  /** Chat is internal — clients have the portal, never the company room. */
  private assertStaff(user: AuthUser): void {
    if (user.role === 'CLIENT') {
      throw new ForbiddenException('Company chat is internal');
    }
  }

  /** Newest page of history (ascending for display). `before` pages backwards. */
  async list(user: AuthUser, before?: string, limit = 50) {
    this.assertStaff(user);
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.prisma.chatMessage.findMany({
      where: before ? { createdAt: { lt: new Date(before) } } : undefined,
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
        files: { select: ATTACHMENT_SELECT },
      },
    });
    const items = rows.reverse().map(({ files, ...m }) => ({ ...m, files: shapeAttachments(files) }));
    return { items, hasMore: rows.length >= take };
  }

  async post(user: AuthUser, body: string, fileAssetIds: string[] = []) {
    this.assertStaff(user);
    const text = body.trim();
    if (!text && fileAssetIds.length === 0) {
      throw new BadRequestException('Write something or attach a file');
    }

    // Only your own not-yet-sent drafts may be attached — otherwise a caller
    // could pass someone else's asset id and republish their file.
    if (fileAssetIds.length > 0) {
      const owned = await this.prisma.fileAsset.count({
        where: {
          id: { in: fileAssetIds },
          createdById: user.id,
          chatMessageId: null,
          taskId: null,
          profileUserId: null,
        },
      });
      if (owned !== fileAssetIds.length) {
        throw new BadRequestException('One or more attachments are not yours to send');
      }
    }

    const message = await this.prisma.$transaction(async (tx) => {
      const m = await tx.chatMessage.create({
        data: { body: text, authorId: user.id },
        select: { id: true },
      });
      if (fileAssetIds.length > 0) {
        await tx.fileAsset.updateMany({
          where: { id: { in: fileAssetIds } },
          data: { chatMessageId: m.id },
        });
      }
      return tx.chatMessage.findUniqueOrThrow({
        where: { id: m.id },
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, name: true } },
          files: { select: ATTACHMENT_SELECT },
        },
      });
    });

    const shaped = { ...message, files: shapeAttachments(message.files) };
    // Live to every open staff app; senders dedupe by id on their own append.
    this.presence.emitToAll('chat:message', shaped);
    // Your own message never counts as unread for you.
    await this.markRead(user);
    return shaped;
  }

  // ── Attachments ──

  /** Step 1: reserve a draft asset + presigned PUT. Not visible until posted. */
  async initAttachment(
    user: AuthUser,
    dto: { filename: string; contentType?: string; sizeBytes?: number },
  ) {
    this.assertStaff(user);
    const asset = await this.prisma.fileAsset.create({
      data: { displayName: dto.filename, createdById: user.id },
      select: { id: true },
    });
    const init = await this.files.initUpload({ ...dto, fileAssetId: asset.id }, user);
    return { ...init, fileAssetId: asset.id };
  }

  /** Step 2: the PUT landed — hand it to the scanner. */
  async finalizeAttachment(user: AuthUser, versionId: string, meta: Meta) {
    this.assertStaff(user);
    await this.assertOwnDraft(user, versionId);
    return this.files.finalize(versionId, user, meta);
  }

  /** Poll while a just-uploaded attachment is still being scanned. */
  async attachmentStatus(user: AuthUser, versionId: string) {
    this.assertStaff(user);
    return this.files.scanStatus(versionId);
  }

  /**
   * Download a chat attachment. Any staff member may open anything shared in
   * the company room — but ONLY chat files come through here, so this can
   * never be used to reach a task or profile file the caller can't see.
   * `inline` renders in the browser (image thumbnails, viewing a PDF) instead
   * of forcing a Save dialog.
   */
  async downloadAttachment(user: AuthUser, versionId: string, inline = false) {
    this.assertStaff(user);
    const version = await this.prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: { fileAsset: { select: { chatMessageId: true } } },
    });
    if (!version?.fileAsset.chatMessageId) throw new NotFoundException('File not found');
    return this.files.download(versionId, user, inline);
  }

  /** A draft is an asset you created that has not been attached to anything yet. */
  private async assertOwnDraft(user: AuthUser, versionId: string): Promise<void> {
    const v = await this.prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: {
        fileAsset: {
          select: { createdById: true, chatMessageId: true, taskId: true, profileUserId: true },
        },
      },
    });
    const a = v?.fileAsset;
    if (!a || a.createdById !== user.id || a.chatMessageId || a.taskId || a.profileUserId) {
      throw new NotFoundException('Upload not found');
    }
  }

  // ── Read state & presence ──

  async markRead(user: AuthUser) {
    this.assertStaff(user);
    const lastReadAt = new Date();
    await this.prisma.chatReadState.upsert({
      where: { userId: user.id },
      update: { lastReadAt },
      create: { userId: user.id, lastReadAt },
    });
    return { lastReadAt };
  }

  /**
   * Who is active right now — "active" means checked in for work (an open
   * attendance session), the same definition the rest of the system uses.
   * Open to all staff (unlike /attendance/online, which is HR-scoped and
   * carries emails/teams): the room shows names only.
   */
  async activeNow(user: AuthUser) {
    this.assertStaff(user);
    const sessions = await this.prisma.attendanceSession.findMany({
      where: { checkOutAt: null },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { checkInAt: 'asc' },
    });
    // One entry per person even if data ever holds two open sessions.
    const seen = new Set<string>();
    return sessions
      .filter((s) => !seen.has(s.user.id) && seen.add(s.user.id))
      .map((s) => ({ id: s.user.id, name: s.user.name }));
  }

  async unreadCount(user: AuthUser): Promise<{ count: number }> {
    this.assertStaff(user);
    const state = await this.prisma.chatReadState.findUnique({
      where: { userId: user.id },
      select: { lastReadAt: true },
    });
    const count = await this.prisma.chatMessage.count({
      where: {
        authorId: { not: user.id },
        ...(state ? { createdAt: { gt: state.lastReadAt } } : {}),
      },
    });
    return { count };
  }
}
