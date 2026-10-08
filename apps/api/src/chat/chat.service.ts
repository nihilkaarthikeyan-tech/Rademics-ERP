import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../attendance/presence.service';
import { FilesService } from '../files/files.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AuthUser } from '../auth/auth-user';

/** Audit metadata shape produced by reqMeta(). */
type Meta = { ip?: string | null; userAgent?: string | null };

/** Roles that may remove ANYONE's message, for moderation — not just their own. */
const CAN_MODERATE = ['SUPER_ADMIN', 'HR'];

/**
 * Per-PERSON flood guard, deliberately not the app's IP-based @Throttle
 * (app.module.ts): an office shares one IP, so an IP limit tight enough to
 * stop one person spamming would also cap everyone else sitting behind the
 * same NAT. This counts THIS user's own recent messages instead.
 */
const FLOOD_LIMIT = 8;
const FLOOD_WINDOW_MS = 10_000;

/** How long an author may still edit their own message. Long enough to fix a
 *  typo, short enough that the room's history can't be quietly rewritten. */
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/** The reaction palette. A fixed set keeps the room professional and renders
 *  identically for everyone — this is a workplace, not a sticker shop. */
const REACTION_EMOJI = ['👍', '❤️', '😂', '🎉', '👏', '😮', '😢', '🙏'];

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

/** Everything the UI needs for one message — one shape for list, post, edit, pin. */
const MESSAGE_SELECT = {
  id: true,
  body: true,
  createdAt: true,
  deletedAt: true,
  editedAt: true,
  pinnedAt: true,
  author: { select: { id: true, name: true } },
  files: { select: ATTACHMENT_SELECT },
  reactions: {
    orderBy: { createdAt: 'asc' },
    select: { emoji: true, userId: true, user: { select: { name: true } } },
  },
} as const;

type ReactionRow = { emoji: string; userId: string; user: { name: string } };

type MessageRow = {
  id: string;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
  editedAt: Date | null;
  pinnedAt: Date | null;
  author: { id: string; name: string } | null;
  files: AssetRow[];
  reactions: ReactionRow[];
};

function shapeReactions(reactions: ReactionRow[]) {
  return reactions.map((r) => ({ emoji: r.emoji, userId: r.userId, userName: r.user.name }));
}

/** A deleted message keeps its row (attribution, audit) but shows as a tombstone. */
function shapeMessage(m: MessageRow) {
  if (m.deletedAt) {
    return {
      id: m.id,
      body: '',
      createdAt: m.createdAt,
      author: m.author,
      files: [],
      reactions: [],
      edited: false,
      pinned: false,
      deleted: true,
    };
  }
  return {
    id: m.id,
    body: m.body,
    createdAt: m.createdAt,
    author: m.author,
    files: shapeAttachments(m.files),
    reactions: shapeReactions(m.reactions),
    edited: Boolean(m.editedAt),
    pinned: Boolean(m.pinnedAt),
    deleted: false,
  };
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
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Chat is internal — clients have the portal, never the company room. */
  private assertStaff(user: AuthUser): void {
    if (user.role === 'CLIENT') {
      throw new ForbiddenException('Company chat is internal');
    }
  }

  /** Newest page of history (ascending for display). `before` pages backwards.
   *  Includes the caller's read pointer AS OF THIS FETCH so the UI can draw the
   *  "new messages" line — the page marks the room read immediately after. */
  async list(user: AuthUser, before?: string, limit = 50) {
    this.assertStaff(user);
    const take = Math.min(Math.max(limit, 1), 100);
    const [rows, readState] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: before ? { createdAt: { lt: new Date(before) } } : undefined,
        orderBy: { createdAt: 'desc' },
        take,
        select: MESSAGE_SELECT,
      }),
      this.prisma.chatReadState.findUnique({
        where: { userId: user.id },
        select: { lastReadAt: true },
      }),
    ]);
    const items = rows.reverse().map(shapeMessage);
    return { items, hasMore: rows.length >= take, lastReadAt: readState?.lastReadAt ?? null };
  }

  /** Staff directory for @mention autocomplete — names only, no emails/teams. */
  async members(user: AuthUser) {
    this.assertStaff(user);
    const users = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { not: 'CLIENT' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    return users;
  }

  async post(user: AuthUser, body: string, fileAssetIds: string[] = []) {
    this.assertStaff(user);
    const text = body.trim();
    if (!text && fileAssetIds.length === 0) {
      throw new BadRequestException('Write something or attach a file');
    }
    await this.assertNotFlooding(user);

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
        select: MESSAGE_SELECT,
      });
    });

    const shaped = shapeMessage(message);
    // Live to every open staff app; senders dedupe by id on their own append.
    this.presence.emitToAll('chat:message', shaped);
    // Your own message never counts as unread for you.
    await this.markRead(user);
    // Mentions ring the bell even for someone who doesn't have the room open.
    await this.notifyMentions(user, message.id, text);
    return shaped;
  }

  /**
   * "@Full Name" in a message pings that person via the notification bell.
   * Matched against real staff names (longest first, so "@Priya Kumar" wins
   * over a hypothetical "@Priya") — free-typed @words that match nobody are
   * just text. In-app only: chat is live conversation, not email material.
   */
  private async notifyMentions(author: AuthUser, messageId: string, text: string): Promise<void> {
    if (!text.includes('@')) return;
    const lower = text.toLowerCase();
    const staff = await this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { not: 'CLIENT' }, id: { not: author.id } },
      select: { id: true, name: true },
    });
    const mentioned = staff
      .filter((u) => u.name.trim().length > 1 && lower.includes(`@${u.name.toLowerCase()}`))
      .map((u) => u.id);
    if (mentioned.length === 0) return;

    const authorRow = await this.prisma.user.findUnique({
      where: { id: author.id },
      select: { name: true },
    });
    const excerpt = text.length > 120 ? `${text.slice(0, 117)}…` : text;
    await this.notifications.notifyMany(mentioned, {
      type: 'CHAT_MENTION',
      eventGroup: 'chat',
      title: `${authorRow?.name ?? 'Someone'} mentioned you in the company chat`,
      body: excerpt,
      entityType: 'ChatMessage',
      entityId: messageId,
      channel: 'IN_APP',
    });
  }

  /** Cheap, per-user check — a handful of quick messages is normal conversation;
   *  a burst past this is a script or someone trying to drown out the room. */
  private async assertNotFlooding(user: AuthUser): Promise<void> {
    const recent = await this.prisma.chatMessage.count({
      where: { authorId: user.id, createdAt: { gte: new Date(Date.now() - FLOOD_WINDOW_MS) } },
    });
    if (recent >= FLOOD_LIMIT) {
      throw new HttpException(
        "You're sending messages too fast — wait a few seconds and try again.",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /**
   * Delete a message: the author may remove their own; HR/Super Admin may
   * remove ANYONE's for moderation. Soft-delete — the row (and who sent it,
   * what it said) stays for the audit trail; every other viewer just sees a
   * quiet "message removed" tombstone once the live event lands.
   */
  async remove(user: AuthUser, messageId: string, meta: Meta) {
    this.assertStaff(user);
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, body: true, authorId: true, deletedAt: true },
    });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');

    const isAuthor = message.authorId === user.id;
    const isModerator = CAN_MODERATE.includes(user.role);
    if (!isAuthor && !isModerator) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), deletedById: user.id },
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'CHAT_MESSAGE_DELETED',
      entityType: 'ChatMessage',
      entityId: messageId,
      before: { body: message.body, authorId: message.authorId, moderated: !isAuthor },
      ...meta,
    });

    this.presence.emitToAll('chat:messageDeleted', { id: messageId });
    return { id: messageId, deleted: true };
  }

  /**
   * Edit your own message within the edit window. The "(edited)" flag travels
   * with the message so nothing in the room changes silently.
   */
  async edit(user: AuthUser, messageId: string, body: string, meta: Meta) {
    this.assertStaff(user);
    const text = body.trim();
    if (!text) throw new BadRequestException('A message cannot be edited to nothing — delete it instead');

    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, body: true, authorId: true, deletedAt: true, createdAt: true },
    });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');
    if (message.authorId !== user.id) throw new ForbiddenException('You can only edit your own messages');
    if (Date.now() - message.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new BadRequestException('The edit window has passed — post a follow-up instead');
    }

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: { body: text, editedAt: new Date() },
      select: MESSAGE_SELECT,
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'CHAT_MESSAGE_EDITED',
      entityType: 'ChatMessage',
      entityId: messageId,
      before: { body: message.body },
      after: { body: text },
      ...meta,
    });

    const shaped = shapeMessage(updated);
    this.presence.emitToAll('chat:messageEdited', shaped);
    return shaped;
  }

  // ── Reactions ──

  /** Toggle one emoji for the caller: on if absent, off if present. */
  async react(user: AuthUser, messageId: string, emoji: string) {
    this.assertStaff(user);
    if (!REACTION_EMOJI.includes(emoji)) {
      throw new BadRequestException('That reaction is not available');
    }
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, deletedAt: true },
    });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');

    const existing = await this.prisma.chatReaction.findUnique({
      where: { messageId_userId_emoji: { messageId, userId: user.id, emoji } },
      select: { id: true },
    });
    if (existing) {
      await this.prisma.chatReaction.delete({ where: { id: existing.id } });
    } else {
      await this.prisma.chatReaction.create({ data: { messageId, userId: user.id, emoji } });
    }

    const reactions = await this.prisma.chatReaction.findMany({
      where: { messageId },
      orderBy: { createdAt: 'asc' },
      select: { emoji: true, userId: true, user: { select: { name: true } } },
    });
    const shaped = { id: messageId, reactions: shapeReactions(reactions) };
    this.presence.emitToAll('chat:reactions', shaped);
    return shaped;
  }

  // ── Pinned announcements (HR / Super Admin) ──

  /** Currently pinned, newest pin first — the room banner shows the top one. */
  async pinned(user: AuthUser) {
    this.assertStaff(user);
    const rows = await this.prisma.chatMessage.findMany({
      where: { pinnedAt: { not: null }, deletedAt: null },
      orderBy: { pinnedAt: 'desc' },
      take: 5,
      select: MESSAGE_SELECT,
    });
    return rows.map(shapeMessage);
  }

  async setPinned(user: AuthUser, messageId: string, pin: boolean, meta: Meta) {
    this.assertStaff(user);
    if (!CAN_MODERATE.includes(user.role)) {
      throw new ForbiddenException('Only HR or an admin can pin announcements');
    }
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, deletedAt: true, pinnedAt: true },
    });
    if (!message || message.deletedAt) throw new NotFoundException('Message not found');

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: pin
        ? { pinnedAt: new Date(), pinnedById: user.id }
        : { pinnedAt: null, pinnedById: null },
      select: MESSAGE_SELECT,
    });

    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: pin ? 'CHAT_MESSAGE_PINNED' : 'CHAT_MESSAGE_UNPINNED',
      entityType: 'ChatMessage',
      entityId: messageId,
      ...meta,
    });

    const shaped = shapeMessage(updated);
    this.presence.emitToAll(pin ? 'chat:pinned' : 'chat:unpinned', pin ? shaped : { id: messageId });
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
    return this.files.scanStatus(versionId, user);
  }

  /**
   * Download a chat attachment. Any staff member may open anything shared in
   * the company room — but ONLY chat files come through here, so this can
   * never be used to reach a task or profile file the caller can't see.
   * A deleted message's attachments go with it: moderating a message must
   * also pull whatever was attached to it out of reach.
   * `inline` renders in the browser (image thumbnails, viewing a PDF) instead
   * of forcing a Save dialog.
   */
  async downloadAttachment(user: AuthUser, versionId: string, inline = false) {
    this.assertStaff(user);
    const version = await this.prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: { fileAsset: { select: { chatMessageId: true, chatMessage: { select: { deletedAt: true } } } } },
    });
    if (!version?.fileAsset.chatMessageId || version.fileAsset.chatMessage?.deletedAt) {
      throw new NotFoundException('File not found');
    }
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
        deletedAt: null,
        ...(state ? { createdAt: { gt: state.lastReadAt } } : {}),
      },
    });
    return { count };
  }
}
