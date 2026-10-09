import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../attendance/presence.service';
import { FilesService } from '../files/files.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StorageService } from '../storage/storage.service';
import type { AuthUser } from '../auth/auth-user';

/** Audit metadata shape produced by reqMeta(). */
type Meta = { ip?: string | null; userAgent?: string | null };

/** The company room every staff member is in — created by the rooms migration. */
export const COMPANY_ROOM_ID = '00000000-0000-4000-8000-000000000001';

/** Roles that may remove ANYONE's message, pin announcements, and run groups. */
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

/** Largest group HR can create in one go — the whole staff fits comfortably. */
const MAX_GROUP_MEMBERS = 300;

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
  roomId: true,
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
  forwarded: true,
  replyTo: {
    select: {
      id: true,
      body: true,
      deletedAt: true,
      author: { select: { id: true, name: true } },
      _count: { select: { files: true } },
    },
  },
} as const;

type ReactionRow = { emoji: string; userId: string; user: { name: string } };

type MessageRow = {
  id: string;
  roomId: string;
  body: string;
  createdAt: Date;
  deletedAt: Date | null;
  editedAt: Date | null;
  pinnedAt: Date | null;
  author: { id: string; name: string } | null;
  files: AssetRow[];
  reactions: ReactionRow[];
  forwarded: boolean;
  replyTo: {
    id: string;
    body: string;
    deletedAt: Date | null;
    author: { id: string; name: string } | null;
    _count: { files: number };
  } | null;
};

/** The quoted original under a reply: who said it and the start of what they said. */
function shapeReplyTo(r: MessageRow['replyTo']) {
  if (!r) return null;
  if (r.deletedAt) return { id: r.id, authorName: r.author?.name ?? 'Someone', body: '', deleted: true };
  const body = r.body || (r._count.files > 0 ? 'Shared a file' : '');
  return {
    id: r.id,
    authorName: r.author?.name ?? 'Someone',
    body: body.length > 160 ? `${body.slice(0, 157)}…` : body,
    deleted: false,
  };
}

function shapeReactions(reactions: ReactionRow[]) {
  return reactions.map((r) => ({ emoji: r.emoji, userId: r.userId, userName: r.user.name }));
}

/** A deleted message keeps its row (attribution, audit) but shows as a tombstone. */
function shapeMessage(m: MessageRow) {
  if (m.deletedAt) {
    return {
      id: m.id,
      roomId: m.roomId,
      body: '',
      createdAt: m.createdAt,
      author: m.author,
      files: [],
      reactions: [],
      replyTo: null,
      edited: false,
      pinned: false,
      deleted: true,
    };
  }
  return {
    id: m.id,
    roomId: m.roomId,
    body: m.body,
    createdAt: m.createdAt,
    author: m.author,
    files: shapeAttachments(m.files),
    reactions: shapeReactions(m.reactions),
    replyTo: shapeReplyTo(m.replyTo),
    forwarded: m.forwarded,
    edited: Boolean(m.editedAt),
    pinned: Boolean(m.pinnedAt),
    deleted: false,
  };
}

type RoomRef = { id: string; kind: 'COMPANY' | 'GROUP' | 'DIRECT'; name: string | null };

/**
 * Company chat with groups and one-to-one conversations (2026-10-09).
 *
 * - COMPANY: one room every staff member is in; membership is implicit.
 * - GROUP: created and managed by HR or a Super Admin; only members can read it.
 * - DIRECT: any two staff members; only those two can read it.
 *
 * Live delivery goes to exactly the people who may read a room: everyone for
 * the company room, each member's own socket room for groups and directs, so
 * a private conversation is never broadcast. Attachments reuse the §5.6 file
 * pipeline (presigned upload → ClamAV scan), and a chat file is downloadable
 * only by people who can read the room it was sent in.
 */
@Injectable()
export class ChatService implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
    private readonly files: FilesService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  private schedulerTimer: NodeJS.Timeout | null = null;

  /** Scheduled messages: check for due ones twice a minute. */
  onModuleInit(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.schedulerTimer = setInterval(() => void this.sendDueScheduled().catch(() => undefined), 30_000);
  }

  onModuleDestroy(): void {
    if (this.schedulerTimer) clearInterval(this.schedulerTimer);
  }

  /** Chat is internal — clients have the portal, never the company chat. */
  private assertStaff(user: AuthUser): void {
    if (user.role === 'CLIENT') {
      throw new ForbiddenException('Company chat is internal');
    }
  }

  private assertModerator(user: AuthUser, what: string): void {
    if (!CAN_MODERATE.includes(user.role)) {
      throw new ForbiddenException(`Only HR or an admin can ${what}`);
    }
  }

  /**
   * The room the caller is acting in. No id means the company room. A group or
   * direct room the caller is not a member of answers 404, never 403, so its
   * existence is not revealed.
   */
  private async roomFor(user: AuthUser, roomId?: string | null): Promise<RoomRef> {
    const id = roomId || COMPANY_ROOM_ID;
    const room = await this.prisma.chatRoom.findUnique({
      where: { id },
      select: { id: true, kind: true, name: true, archivedAt: true },
    });
    if (!room || room.archivedAt) throw new NotFoundException('Conversation not found');
    if (room.kind !== 'COMPANY') {
      const member = await this.prisma.chatRoomMember.findUnique({
        where: { roomId_userId: { roomId: id, userId: user.id } },
        select: { userId: true },
      });
      if (!member) throw new NotFoundException('Conversation not found');
    }
    return room;
  }

  /** Send an event to exactly the people who may read the room. */
  private async emitToRoom(room: { id: string; kind: string }, event: string, payload: unknown): Promise<void> {
    if (room.kind === 'COMPANY') {
      this.presence.emitToAll(event, payload);
      return;
    }
    const members = await this.prisma.chatRoomMember.findMany({
      where: { roomId: room.id },
      select: { userId: true },
    });
    for (const m of members) this.presence.emitToUser(m.userId, event, payload);
  }

  /** The room a message lives in, checked against the caller's access. */
  private async messageRoom(user: AuthUser, messageId: string) {
    const message = await this.prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, roomId: true, body: true, authorId: true, deletedAt: true, createdAt: true, pinnedAt: true },
    });
    if (!message) throw new NotFoundException('Message not found');
    const room = await this.roomFor(user, message.roomId);
    return { message, room };
  }

  // ── Conversations ──

  /**
   * The caller's conversation list: the company room, the groups they are in
   * and their one-to-one chats, newest activity first, each with an unread
   * count and the latest message as a preview.
   */
  async rooms(user: AuthUser) {
    this.assertStaff(user);
    const [memberships, companyRead] = await Promise.all([
      this.prisma.chatRoomMember.findMany({
        where: { userId: user.id, room: { archivedAt: null } },
        select: {
          lastReadAt: true,
          muted: true,
          room: {
            select: {
              id: true,
              kind: true,
              name: true,
              lastMessageAt: true,
              createdBy: { select: { id: true, name: true } },
              _count: { select: { members: true } },
              members: { select: { user: { select: { id: true, name: true } } } },
            },
          },
        },
      }),
      this.prisma.chatReadState.findUnique({ where: { userId: user.id }, select: { lastReadAt: true, muted: true } }),
    ]);
    const company = await this.prisma.chatRoom.findUnique({
      where: { id: COMPANY_ROOM_ID },
      select: { id: true, lastMessageAt: true },
    });

    const entries: {
      id: string;
      kind: 'COMPANY' | 'GROUP' | 'DIRECT';
      name: string;
      lastMessageAt: Date;
      lastReadAt: Date | null;
      muted: boolean;
      memberCount: number | null;
      other: { id: string; name: string } | null;
      createdBy: { id: string; name: string } | null;
    }[] = [];
    if (company) {
      entries.push({
        id: company.id,
        kind: 'COMPANY',
        name: 'Company',
        lastMessageAt: company.lastMessageAt,
        lastReadAt: companyRead?.lastReadAt ?? null,
        muted: companyRead?.muted ?? false,
        memberCount: null,
        other: null,
        createdBy: null,
      });
    }
    for (const m of memberships) {
      const other = m.room.kind === 'DIRECT' ? (m.room.members.map((x) => x.user).find((u) => u.id !== user.id) ?? null) : null;
      entries.push({
        id: m.room.id,
        kind: m.room.kind,
        name: m.room.kind === 'DIRECT' ? (other?.name ?? 'Conversation') : (m.room.name ?? 'Group'),
        lastMessageAt: m.room.lastMessageAt,
        lastReadAt: m.lastReadAt,
        muted: m.muted,
        memberCount: m.room._count.members,
        other,
        createdBy: m.room.createdBy,
      });
    }

    const shaped = await Promise.all(
      entries.map(async (e) => {
        const [last, unread] = await Promise.all([
          this.prisma.chatMessage.findFirst({
            where: { roomId: e.id, deletedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { body: true, createdAt: true, author: { select: { id: true, name: true } }, _count: { select: { files: true } } },
          }),
          this.prisma.chatMessage.count({
            where: {
              roomId: e.id,
              deletedAt: null,
              authorId: { not: user.id },
              ...(e.lastReadAt ? { createdAt: { gt: e.lastReadAt } } : {}),
            },
          }),
        ]);
        return {
          id: e.id,
          kind: e.kind,
          name: e.name,
          memberCount: e.memberCount,
          other: e.other,
          createdBy: e.createdBy,
          muted: e.muted,
          unread,
          lastMessageAt: last?.createdAt ?? null,
          lastMessage: last
            ? {
                body: last.body || (last._count.files > 0 ? 'Shared a file' : ''),
                authorId: last.author?.id ?? null,
                authorName: last.author?.name ?? null,
              }
            : null,
        };
      }),
    );
    // Company first, then everything else by latest activity.
    return shaped.sort((a, b) => {
      if (a.kind === 'COMPANY') return -1;
      if (b.kind === 'COMPANY') return 1;
      const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
      const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
      return bt - at;
    });
  }

  /** People in a room (everyone on staff for the company room). */
  async roomMembers(user: AuthUser, roomId: string) {
    this.assertStaff(user);
    const room = await this.roomFor(user, roomId);
    if (room.kind === 'COMPANY') return this.members(user);
    const rows = await this.prisma.chatRoomMember.findMany({
      where: { roomId: room.id },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((r) => r.user);
  }

  /** Active staff the given ids must all belong to. Returns the de-duplicated set. */
  private async validStaff(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return [];
    const found = await this.prisma.user.findMany({
      where: { id: { in: unique }, status: 'ACTIVE', role: { not: 'CLIENT' } },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      throw new BadRequestException('Some of the people chosen are not active staff');
    }
    return unique;
  }

  /** HR / Super Admin: create a group and add its first members (the creator joins too). */
  async createGroup(user: AuthUser, name: string, memberIds: string[], meta: Meta) {
    this.assertStaff(user);
    this.assertModerator(user, 'create groups');
    const title = name.trim();
    if (!title) throw new BadRequestException('Give the group a name');
    const ids = await this.validStaff([...memberIds, user.id]);
    if (ids.length < 2) throw new BadRequestException('Add at least one other person');
    if (ids.length > MAX_GROUP_MEMBERS) throw new BadRequestException(`A group can have at most ${MAX_GROUP_MEMBERS} people`);

    const room = await this.prisma.chatRoom.create({
      data: {
        kind: 'GROUP',
        name: title,
        createdById: user.id,
        members: { create: ids.map((userId) => ({ userId })) },
      },
      select: { id: true, kind: true, name: true },
    });
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'CHAT_GROUP_CREATED',
      entityType: 'ChatRoom',
      entityId: room.id,
      after: { name: title, members: ids.length },
      ...meta,
    });
    for (const id of ids) this.presence.emitToUser(id, 'chat:roomsChanged', { roomId: room.id });
    return room;
  }

  /** HR / Super Admin: add people to a group. */
  async addMembers(user: AuthUser, roomId: string, memberIds: string[], meta: Meta) {
    this.assertStaff(user);
    this.assertModerator(user, 'add people to groups');
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId }, select: { id: true, kind: true } });
    if (!room || room.kind !== 'GROUP') throw new NotFoundException('Group not found');
    const ids = await this.validStaff(memberIds);
    if (ids.length === 0) throw new BadRequestException('Choose at least one person');
    await this.prisma.chatRoomMember.createMany({
      data: ids.map((userId) => ({ roomId, userId })),
      skipDuplicates: true,
    });
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'CHAT_GROUP_MEMBERS_ADDED',
      entityType: 'ChatRoom',
      entityId: roomId,
      after: { added: ids },
      ...meta,
    });
    await this.emitToRoom(room, 'chat:roomsChanged', { roomId });
    const rows = await this.prisma.chatRoomMember.findMany({
      where: { roomId },
      select: { user: { select: { id: true, name: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return rows.map((r) => r.user);
  }

  /** HR / Super Admin: take someone out of a group. */
  async removeMember(user: AuthUser, roomId: string, memberId: string, meta: Meta) {
    this.assertStaff(user);
    this.assertModerator(user, 'remove people from groups');
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId }, select: { id: true, kind: true } });
    if (!room || room.kind !== 'GROUP') throw new NotFoundException('Group not found');
    await this.emitToRoom(room, 'chat:roomsChanged', { roomId });
    await this.prisma.chatRoomMember.deleteMany({ where: { roomId, userId: memberId } });
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'CHAT_GROUP_MEMBER_REMOVED',
      entityType: 'ChatRoom',
      entityId: roomId,
      after: { removed: memberId },
      ...meta,
    });
    return { roomId, removed: memberId };
  }

  /** Open (or create) the one-to-one conversation with another staff member. */
  async openDirect(user: AuthUser, otherUserId: string) {
    this.assertStaff(user);
    if (otherUserId === user.id) throw new BadRequestException('Choose someone other than yourself');
    await this.validStaff([otherUserId]);
    const directKey = [user.id, otherUserId].sort().join(':');
    const existing = await this.prisma.chatRoom.findUnique({ where: { directKey }, select: { id: true, kind: true, name: true } });
    if (existing) return existing;
    try {
      return await this.prisma.chatRoom.create({
        data: {
          kind: 'DIRECT',
          directKey,
          createdById: user.id,
          members: { create: [{ userId: user.id }, { userId: otherUserId }] },
        },
        select: { id: true, kind: true, name: true },
      });
    } catch {
      // Both people opened the chat at the same instant: the other request won.
      return this.prisma.chatRoom.findUniqueOrThrow({ where: { directKey }, select: { id: true, kind: true, name: true } });
    }
  }

  // ── Messages ──

  /** Newest page of history (ascending for display). `before` pages backwards.
   *  Includes the caller's read pointer AS OF THIS FETCH so the UI can draw the
   *  "new messages" line — the page marks the room read immediately after. */
  async list(user: AuthUser, roomId?: string, before?: string, limit = 50) {
    this.assertStaff(user);
    const room = await this.roomFor(user, roomId);
    const take = Math.min(Math.max(limit, 1), 100);
    const [rows, lastReadAt] = await Promise.all([
      this.prisma.chatMessage.findMany({
        where: { roomId: room.id, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
        orderBy: { createdAt: 'desc' },
        take,
        select: MESSAGE_SELECT,
      }),
      this.readPointer(user, room),
    ]);
    const items = rows.reverse().map(shapeMessage);
    return { items, hasMore: rows.length >= take, lastReadAt };
  }

  /** Staff directory for @mention autocomplete and starting chats — names only. */
  async members(user: AuthUser) {
    this.assertStaff(user);
    return this.prisma.user.findMany({
      where: { status: 'ACTIVE', role: { not: 'CLIENT' } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
  }

  async post(user: AuthUser, body: string, fileAssetIds: string[] = [], roomId?: string, replyToId?: string) {
    this.assertStaff(user);
    const room = await this.roomFor(user, roomId);
    const text = body.trim();
    if (!text && fileAssetIds.length === 0) {
      throw new BadRequestException('Write something or attach a file');
    }
    await this.assertNotFlooding(user);

    // A reply quotes a message from the SAME conversation, never a way to
    // surface text from a room the readers can't see.
    if (replyToId) {
      const original = await this.prisma.chatMessage.findUnique({
        where: { id: replyToId },
        select: { roomId: true },
      });
      if (!original || original.roomId !== room.id) {
        throw new BadRequestException('You can only reply to a message in this conversation');
      }
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
        data: { body: text, authorId: user.id, roomId: room.id, replyToId: replyToId ?? null },
        select: { id: true, createdAt: true },
      });
      if (fileAssetIds.length > 0) {
        await tx.fileAsset.updateMany({
          where: { id: { in: fileAssetIds } },
          data: { chatMessageId: m.id },
        });
      }
      await tx.chatRoom.update({ where: { id: room.id }, data: { lastMessageAt: m.createdAt } });
      return tx.chatMessage.findUniqueOrThrow({
        where: { id: m.id },
        select: MESSAGE_SELECT,
      });
    });

    const shaped = shapeMessage(message);
    // Live to everyone who can read this room; senders dedupe by id on their own append.
    await this.emitToRoom(room, 'chat:message', shaped);
    // Your own message never counts as unread for you.
    await this.markRead(user, room.id);
    // Mentions ring the bell even for someone who doesn't have the room open.
    await this.notifyMentions(user, room, message.id, text);
    return shaped;
  }

  /**
   * "@Full Name" in a message pings that person via the notification bell.
   * Matched against real staff names (longest first, so "@Priya Kumar" wins
   * over a hypothetical "@Priya") — free-typed @words that match nobody are
   * just text. In a group or direct chat only its members can be pinged, so a
   * mention never leaks a private conversation to someone outside it.
   */
  private async notifyMentions(author: AuthUser, room: RoomRef, messageId: string, text: string): Promise<void> {
    if (!text.includes('@')) return;
    const lower = text.toLowerCase();
    const candidates =
      room.kind === 'COMPANY'
        ? await this.prisma.user.findMany({
            where: { status: 'ACTIVE', role: { not: 'CLIENT' }, id: { not: author.id } },
            select: { id: true, name: true },
          })
        : (
            await this.prisma.chatRoomMember.findMany({
              where: { roomId: room.id, userId: { not: author.id } },
              select: { user: { select: { id: true, name: true } } },
            })
          ).map((m) => m.user);
    const mentioned = candidates
      .filter((u) => u.name.trim().length > 1 && lower.includes(`@${u.name.toLowerCase()}`))
      .map((u) => u.id);
    if (mentioned.length === 0) return;

    const authorRow = await this.prisma.user.findUnique({
      where: { id: author.id },
      select: { name: true },
    });
    const where = room.kind === 'COMPANY' ? 'the company chat' : room.kind === 'GROUP' ? (room.name ?? 'a group') : 'a direct message';
    const excerpt = text.length > 120 ? `${text.slice(0, 117)}…` : text;
    await this.notifications.notifyMany(mentioned, {
      type: 'CHAT_MENTION',
      eventGroup: 'chat',
      title: `${authorRow?.name ?? 'Someone'} mentioned you in ${where}`,
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
   * remove anyone's in rooms they can see. Soft-delete — the row (and who sent
   * it, what it said) stays for the audit trail; everyone else sees a quiet
   * "message removed" tombstone once the live event lands.
   */
  async remove(user: AuthUser, messageId: string, meta: Meta) {
    this.assertStaff(user);
    const { message, room } = await this.messageRoom(user, messageId);
    if (message.deletedAt) throw new NotFoundException('Message not found');

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
      before: { body: message.body, authorId: message.authorId, moderated: !isAuthor, roomId: room.id },
      ...meta,
    });

    await this.emitToRoom(room, 'chat:messageDeleted', { id: messageId, roomId: room.id });
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

    const { message, room } = await this.messageRoom(user, messageId);
    if (message.deletedAt) throw new NotFoundException('Message not found');
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
    await this.emitToRoom(room, 'chat:messageEdited', shaped);
    return shaped;
  }

  // ── Reactions ──

  /** Toggle one emoji for the caller: on if absent, off if present. */
  async react(user: AuthUser, messageId: string, emoji: string) {
    this.assertStaff(user);
    if (!REACTION_EMOJI.includes(emoji)) {
      throw new BadRequestException('That reaction is not available');
    }
    const { message, room } = await this.messageRoom(user, messageId);
    if (message.deletedAt) throw new NotFoundException('Message not found');

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
    const shaped = { id: messageId, roomId: room.id, reactions: shapeReactions(reactions) };
    await this.emitToRoom(room, 'chat:reactions', shaped);
    return shaped;
  }

  // ── Pinned announcements (HR / Super Admin) ──

  /** Currently pinned in a room, newest pin first — the room banner shows the top one. */
  /** The room a message is in, for someone who can read that room (404 otherwise). */
  async locate(user: AuthUser, messageId: string) {
    this.assertStaff(user);
    const { message, room } = await this.messageRoom(user, messageId);
    return { messageId: message.id, roomId: room.id };
  }

  async pinned(user: AuthUser, roomId?: string) {
    this.assertStaff(user);
    const room = await this.roomFor(user, roomId);
    const rows = await this.prisma.chatMessage.findMany({
      where: { roomId: room.id, pinnedAt: { not: null }, deletedAt: null },
      orderBy: { pinnedAt: 'desc' },
      take: 5,
      select: MESSAGE_SELECT,
    });
    return rows.map(shapeMessage);
  }

  async setPinned(user: AuthUser, messageId: string, pin: boolean, meta: Meta) {
    this.assertStaff(user);
    this.assertModerator(user, 'pin announcements');
    const { message, room } = await this.messageRoom(user, messageId);
    if (message.deletedAt) throw new NotFoundException('Message not found');

    const updated = await this.prisma.chatMessage.update({
      where: { id: messageId },
      data: pin ? { pinnedAt: new Date(), pinnedById: user.id } : { pinnedAt: null, pinnedById: null },
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
    await this.emitToRoom(room, pin ? 'chat:pinned' : 'chat:unpinned', pin ? shaped : { id: messageId, roomId: room.id });
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
   * Download a chat attachment — only for people who can read the room it was
   * sent in, and only chat files come through here, so this can never reach a
   * task or profile file. A deleted message's attachments go with it.
   * `inline` renders in the browser (image thumbnails, viewing a PDF).
   */
  async downloadAttachment(user: AuthUser, versionId: string, inline = false) {
    this.assertStaff(user);
    const version = await this.prisma.fileVersion.findUnique({
      where: { id: versionId },
      select: { fileAsset: { select: { chatMessageId: true, chatMessage: { select: { deletedAt: true, roomId: true } } } } },
    });
    const msg = version?.fileAsset.chatMessage;
    if (!version?.fileAsset.chatMessageId || !msg || msg.deletedAt) {
      throw new NotFoundException('File not found');
    }
    await this.roomFor(user, msg.roomId);
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

  private async readPointer(user: AuthUser, room: RoomRef): Promise<Date | null> {
    if (room.kind === 'COMPANY') {
      const s = await this.prisma.chatReadState.findUnique({ where: { userId: user.id }, select: { lastReadAt: true } });
      return s?.lastReadAt ?? null;
    }
    const m = await this.prisma.chatRoomMember.findUnique({
      where: { roomId_userId: { roomId: room.id, userId: user.id } },
      select: { lastReadAt: true },
    });
    return m?.lastReadAt ?? null;
  }

  async markRead(user: AuthUser, roomId?: string) {
    this.assertStaff(user);
    const room = await this.roomFor(user, roomId);
    const lastReadAt = new Date();
    if (room.kind === 'COMPANY') {
      await this.prisma.chatReadState.upsert({
        where: { userId: user.id },
        update: { lastReadAt },
        create: { userId: user.id, lastReadAt },
      });
    } else {
      await this.prisma.chatRoomMember.update({
        where: { roomId_userId: { roomId: room.id, userId: user.id } },
        data: { lastReadAt },
      });
    }
    // Read receipts: the others in the room see "Seen" move on.
    await this.emitToRoom(room, 'chat:read', { roomId: room.id, userId: user.id, lastReadAt });
    return { lastReadAt };
  }

  /**
   * Read receipts: how far each person in the room has read. The company room
   * counts everyone on staff who has opened it.
   */
  async reads(user: AuthUser, roomId: string) {
    this.assertStaff(user);
    const room = await this.roomFor(user, roomId);
    if (room.kind === 'COMPANY') {
      const rows = await this.prisma.chatReadState.findMany({
        where: { user: { status: 'ACTIVE', role: { not: 'CLIENT' } } },
        select: { lastReadAt: true, user: { select: { id: true, name: true } } },
      });
      return rows.map((r) => ({ userId: r.user.id, name: r.user.name, lastReadAt: r.lastReadAt }));
    }
    const rows = await this.prisma.chatRoomMember.findMany({
      where: { roomId: room.id },
      select: { lastReadAt: true, user: { select: { id: true, name: true } } },
    });
    return rows.map((r) => ({ userId: r.user.id, name: r.user.name, lastReadAt: r.lastReadAt }));
  }

  /** Mute or unmute a conversation for the caller only. */
  async setMuted(user: AuthUser, roomId: string, muted: boolean) {
    this.assertStaff(user);
    const room = await this.roomFor(user, roomId);
    if (room.kind === 'COMPANY') {
      await this.prisma.chatReadState.upsert({
        where: { userId: user.id },
        update: { muted },
        create: { userId: user.id, muted },
      });
    } else {
      await this.prisma.chatRoomMember.update({
        where: { roomId_userId: { roomId: room.id, userId: user.id } },
        data: { muted },
      });
    }
    return { roomId: room.id, muted };
  }

  /**
   * Find messages (text or file name) across every conversation the caller can
   * read: the company room plus their own groups and direct chats, nothing else.
   */
  async search(user: AuthUser, q: string, roomId?: string) {
    this.assertStaff(user);
    const term = q.trim();
    if (term.length < 2) return [];
    const rooms = await this.rooms(user);
    const readable = roomId ? rooms.filter((r) => r.id === roomId) : rooms;
    if (readable.length === 0) return [];
    const byId = new Map(readable.map((r) => [r.id, r]));
    const rows = await this.prisma.chatMessage.findMany({
      where: {
        roomId: { in: [...byId.keys()] },
        deletedAt: null,
        OR: [
          { body: { contains: term, mode: 'insensitive' } },
          { files: { some: { displayName: { contains: term, mode: 'insensitive' } } } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true,
        roomId: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true } },
        files: { select: { displayName: true } },
      },
    });
    return rows.map((m) => {
      const room = byId.get(m.roomId)!;
      return {
        id: m.id,
        roomId: m.roomId,
        roomName: room.name,
        roomKind: room.kind,
        body: m.body,
        fileNames: m.files.map((f) => f.displayName),
        createdAt: m.createdAt,
        author: m.author,
      };
    });
  }

  /**
   * Who is active right now — "active" means checked in for work (an open
   * attendance session), the same definition the rest of the system uses.
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

  // ── Groups: rename / remove ──

  /** HR / Super Admin rename a group. */
  async renameGroup(user: AuthUser, roomId: string, name: string, meta: Meta) {
    this.assertStaff(user);
    this.assertModerator(user, 'rename groups');
    const title = name.trim();
    if (!title) throw new BadRequestException('Give the group a name');
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId }, select: { id: true, kind: true, name: true, archivedAt: true } });
    if (!room || room.kind !== 'GROUP' || room.archivedAt) throw new NotFoundException('Group not found');
    await this.prisma.chatRoom.update({ where: { id: roomId }, data: { name: title } });
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'CHAT_GROUP_RENAMED',
      entityType: 'ChatRoom',
      entityId: roomId,
      before: { name: room.name },
      after: { name: title },
      ...meta,
    });
    await this.emitToRoom(room, 'chat:roomsChanged', { roomId });
    return { id: roomId, name: title };
  }

  /**
   * HR / Super Admin remove a group. It disappears for everyone, but nothing is
   * erased: the messages and files stay on the server as a record.
   */
  async archiveGroup(user: AuthUser, roomId: string, meta: Meta) {
    this.assertStaff(user);
    this.assertModerator(user, 'delete groups');
    const room = await this.prisma.chatRoom.findUnique({ where: { id: roomId }, select: { id: true, kind: true, name: true, archivedAt: true } });
    if (!room || room.kind !== 'GROUP' || room.archivedAt) throw new NotFoundException('Group not found');
    await this.prisma.chatRoom.update({ where: { id: roomId }, data: { archivedAt: new Date(), archivedById: user.id } });
    await this.prisma.chatScheduledMessage.updateMany({
      where: { roomId, sentAt: null, cancelledAt: null },
      data: { cancelledAt: new Date(), failedReason: 'The group was deleted' },
    });
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'CHAT_GROUP_DELETED',
      entityType: 'ChatRoom',
      entityId: roomId,
      before: { name: room.name },
      ...meta,
    });
    await this.emitToRoom(room, 'chat:roomsChanged', { roomId, removed: true });
    return { id: roomId, archived: true };
  }

  // ── Files shared in a conversation ──

  /** Every file still shared in a conversation, newest first. */
  async roomFiles(user: AuthUser, roomId: string) {
    this.assertStaff(user);
    const room = await this.roomFor(user, roomId);
    const rows = await this.prisma.fileAsset.findMany({
      where: { chatMessage: { roomId: room.id, deletedAt: null } },
      orderBy: { createdAt: 'desc' },
      take: 300,
      select: {
        ...ATTACHMENT_SELECT,
        chatMessage: { select: { id: true, createdAt: true, author: { select: { id: true, name: true } } } },
      },
    });
    return rows
      .map((r) => {
        const [file] = shapeAttachments([r as unknown as AssetRow]);
        if (!file || !r.chatMessage) return null;
        return { ...file, messageId: r.chatMessage.id, sharedAt: r.chatMessage.createdAt, sharedBy: r.chatMessage.author };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
  }

  // ── Forward ──

  /**
   * Copy a message into another conversation the caller can post in. Its files
   * get their own stored copies, so deleting either message never affects the other.
   */
  async forward(user: AuthUser, messageId: string, targetRoomId: string) {
    this.assertStaff(user);
    const { message, room: source } = await this.messageRoom(user, messageId);
    if (message.deletedAt) throw new NotFoundException('Message not found');
    const target = await this.roomFor(user, targetRoomId);
    if (target.id === source.id) throw new BadRequestException('Choose a different conversation');
    await this.assertNotFlooding(user);

    const assets = await this.prisma.fileAsset.findMany({
      where: { chatMessageId: messageId },
      select: {
        displayName: true,
        versions: {
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { storageKey: true, originalName: true, sizeBytes: true, contentType: true, scanStatus: true, deletedAt: true },
        },
      },
    });
    // Only clean, available files travel — never one still being scanned or quarantined.
    const copies: { displayName: string; key: string; v: (typeof assets)[number]['versions'][number] }[] = [];
    for (const a of assets) {
      const v = a.versions[0];
      if (!v || v.deletedAt || v.scanStatus !== 'AVAILABLE') continue;
      const key = `files/fwd/${randomUUID()}/${v.storageKey.split('/').pop()}`;
      await this.storage.copy(v.storageKey, key);
      copies.push({ displayName: a.displayName, key, v });
    }
    if (!message.body.trim() && copies.length === 0) {
      throw new BadRequestException('There is nothing in that message that can be forwarded');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const m = await tx.chatMessage.create({
        data: { body: message.body, authorId: user.id, roomId: target.id, forwarded: true },
        select: { id: true, createdAt: true },
      });
      for (const c of copies) {
        await tx.fileAsset.create({
          data: {
            displayName: c.displayName,
            createdById: user.id,
            chatMessageId: m.id,
            versions: {
              create: {
                versionNumber: 1,
                storageKey: c.key,
                originalName: c.v.originalName,
                sizeBytes: c.v.sizeBytes,
                contentType: c.v.contentType,
                scanStatus: 'AVAILABLE',
                uploadedById: user.id,
              },
            },
          },
        });
      }
      await tx.chatRoom.update({ where: { id: target.id }, data: { lastMessageAt: m.createdAt } });
      return tx.chatMessage.findUniqueOrThrow({ where: { id: m.id }, select: MESSAGE_SELECT });
    });
    const shaped = shapeMessage(created);
    await this.emitToRoom(target, 'chat:message', shaped);
    await this.markRead(user, target.id);
    return shaped;
  }

  // ── Scheduled messages ──

  async schedule(user: AuthUser, roomId: string | undefined, body: string, sendAt: string) {
    this.assertStaff(user);
    const room = await this.roomFor(user, roomId);
    const text = body.trim();
    if (!text) throw new BadRequestException('Write the message to schedule');
    const when = new Date(sendAt);
    const now = Date.now();
    if (Number.isNaN(when.getTime()) || when.getTime() < now + 60_000) {
      throw new BadRequestException('Pick a time at least a minute from now');
    }
    if (when.getTime() > now + 60 * 24 * 60 * 60 * 1000) {
      throw new BadRequestException('Messages can be scheduled up to 60 days ahead');
    }
    const pendingCount = await this.prisma.chatScheduledMessage.count({
      where: { authorId: user.id, sentAt: null, cancelledAt: null },
    });
    if (pendingCount >= 50) throw new BadRequestException('You already have 50 messages waiting to be sent');
    return this.prisma.chatScheduledMessage.create({
      data: { roomId: room.id, authorId: user.id, body: text, sendAt: when },
      select: { id: true, roomId: true, body: true, sendAt: true },
    });
  }

  /** The caller's own messages waiting to be sent in a conversation. */
  async listScheduled(user: AuthUser, roomId?: string) {
    this.assertStaff(user);
    const room = await this.roomFor(user, roomId);
    return this.prisma.chatScheduledMessage.findMany({
      where: { roomId: room.id, authorId: user.id, sentAt: null, cancelledAt: null },
      orderBy: { sendAt: 'asc' },
      select: { id: true, roomId: true, body: true, sendAt: true },
    });
  }

  async cancelScheduled(user: AuthUser, id: string) {
    this.assertStaff(user);
    const { count } = await this.prisma.chatScheduledMessage.updateMany({
      where: { id, authorId: user.id, sentAt: null, cancelledAt: null },
      data: { cancelledAt: new Date() },
    });
    if (!count) throw new NotFoundException('That scheduled message was already sent or cancelled');
    return { id, cancelled: true };
  }

  /**
   * Post every scheduled message that is due, as its author, through the normal
   * send path. Each is claimed first, so a message is never sent twice.
   */
  async sendDueScheduled(): Promise<number> {
    const due = await this.prisma.chatScheduledMessage.findMany({
      where: { sendAt: { lte: new Date() }, sentAt: null, cancelledAt: null },
      orderBy: { sendAt: 'asc' },
      take: 25,
      select: {
        id: true,
        roomId: true,
        body: true,
        author: { select: { id: true, email: true, role: true, resourceType: true, status: true, desktopCheckInRequired: true } },
      },
    });
    let sent = 0;
    for (const s of due) {
      const claim = await this.prisma.chatScheduledMessage.updateMany({
        where: { id: s.id, sentAt: null, cancelledAt: null },
        data: { sentAt: new Date() },
      });
      if (!claim.count) continue;
      try {
        if (s.author.status !== 'ACTIVE') throw new Error('The account is no longer active');
        const author: AuthUser = {
          id: s.author.id,
          email: s.author.email,
          role: s.author.role as AuthUser['role'],
          resourceType: s.author.resourceType as AuthUser['resourceType'],
          desktopCheckInRequired: s.author.desktopCheckInRequired,
        };
        const m = await this.post(author, s.body, [], s.roomId);
        await this.prisma.chatScheduledMessage.update({ where: { id: s.id }, data: { messageId: m.id } });
        this.presence.emitToUser(s.author.id, 'chat:scheduledSent', { id: s.id, roomId: s.roomId });
        sent++;
      } catch (err) {
        await this.prisma.chatScheduledMessage.update({
          where: { id: s.id },
          data: { failedReason: (err as Error).message.slice(0, 300) },
        });
      }
    }
    return sent;
  }

  // ── Storage (HR / Super Admin) ──

  /** How much server space chat files take, the biggest ones, and the upload limit. */
  async storageSummary(user: AuthUser) {
    this.assertStaff(user);
    this.assertModerator(user, 'see chat storage');
    const totals = await this.prisma.$queryRaw<{ files: bigint; bytes: bigint | null }[]>`
      SELECT COUNT(*) AS files, SUM(v."sizeBytes") AS bytes
      FROM file_versions v
      JOIN file_assets a ON a.id = v."fileAssetId"
      JOIN chat_messages m ON m.id = a."chatMessageId"
      WHERE v."deletedAt" IS NULL`;
    const byRoom = await this.prisma.$queryRaw<{ roomId: string; files: bigint; bytes: bigint | null }[]>`
      SELECT m."roomId" AS "roomId", COUNT(*) AS files, SUM(v."sizeBytes") AS bytes
      FROM file_versions v
      JOIN file_assets a ON a.id = v."fileAssetId"
      JOIN chat_messages m ON m.id = a."chatMessageId"
      WHERE v."deletedAt" IS NULL
      GROUP BY m."roomId"
      ORDER BY bytes DESC NULLS LAST
      LIMIT 8`;
    const biggest = await this.prisma.fileVersion.findMany({
      where: { deletedAt: null, fileAsset: { chatMessageId: { not: null } } },
      orderBy: { sizeBytes: 'desc' },
      take: 8,
      select: {
        originalName: true,
        sizeBytes: true,
        uploadedAt: true,
        fileAsset: { select: { chatMessage: { select: { room: { select: { kind: true, name: true } } } } } },
      },
    });
    const roomRows = await this.prisma.chatRoom.findMany({
      where: { id: { in: byRoom.map((r) => r.roomId) } },
      select: { id: true, kind: true, name: true },
    });
    const roomLabel = (r?: { kind: string; name: string | null } | null) =>
      !r ? 'Conversation' : r.kind === 'COMPANY' ? 'Company' : r.kind === 'DIRECT' ? 'A one-to-one chat' : (r.name ?? 'Group');
    const rules = await this.files.fileRules();
    return {
      files: Number(totals[0]?.files ?? 0),
      bytes: Number(totals[0]?.bytes ?? 0),
      uploadLimitBytes: rules.maxBytes,
      byRoom: byRoom.map((r) => ({
        room: roomLabel(roomRows.find((x) => x.id === r.roomId)),
        files: Number(r.files),
        bytes: Number(r.bytes ?? 0),
      })),
      biggest: biggest.map((b) => ({
        name: b.originalName,
        bytes: b.sizeBytes ?? 0,
        uploadedAt: b.uploadedAt,
        room: roomLabel(b.fileAsset.chatMessage?.room),
      })),
    };
  }

  /** Unread across every conversation the caller can read — the nav badge. */
  async unreadCount(user: AuthUser): Promise<{ count: number }> {
    this.assertStaff(user);
    const rooms = await this.rooms(user);
    // Muted conversations keep their own count in the list but stay out of the badge.
    return { count: rooms.reduce((n, r) => n + (r.muted ? 0 : r.unread), 0) };
  }
}
