import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';
import { Role, ResourceType } from '@rademics/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailProducer } from '../queue/email.producer';
import { randomUUID } from 'node:crypto';
import { generateOpaqueToken, hashToken } from './tokens';
import type { AuthUser } from './auth-user';

interface RequestMeta {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

const RULES = DEFAULT_BUSINESS_RULES;
const INVITE_TTL_DAYS = 7;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly email: EmailProducer,
  ) {}

  // ─── Login ────────────────────────────────────────────────────────────────

  async login(email: string, password: string, meta: RequestMeta): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });

    // Generic failure to avoid user enumeration (Spec §5.1).
    const invalid = () => new UnauthorizedException('Invalid email or password');

    if (!user || !user.passwordHash || user.status !== 'ACTIVE') {
      await this.audit.record({
        actorEmail: email,
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user?.id,
        ...meta,
      });
      throw invalid();
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account is temporarily locked. Try again later.');
    }

    const ok = await argonVerify(user.passwordHash, password);
    if (!ok) {
      await this.registerFailedLogin(user.id, user.email, meta);
      throw invalid();
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: 'LOGIN_SUCCESS',
      entityType: 'User',
      entityId: user.id,
      ...meta,
    });

    return this.issueTokens(user, meta);
  }

  private async registerFailedLogin(userId: string, email: string, meta: RequestMeta): Promise<void> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });

    await this.audit.record({
      actorId: userId,
      actorEmail: email,
      action: 'LOGIN_FAILED',
      entityType: 'User',
      entityId: userId,
      ...meta,
    });

    if (updated.failedLoginCount >= RULES.failedLoginLockCount) {
      const lockedUntil = new Date(Date.now() + RULES.failedLoginLockMinutes * 60_000);
      await this.prisma.user.update({ where: { id: userId }, data: { lockedUntil } });
      await this.audit.record({
        actorId: userId,
        actorEmail: email,
        action: 'ACCOUNT_LOCKED',
        entityType: 'User',
        entityId: userId,
        after: { lockedUntil, minutes: RULES.failedLoginLockMinutes },
        ...meta,
      });
      await this.email.enqueue({
        to: email,
        subject: 'Your Rademics ERP account was locked',
        html: `<p>Your account was locked for ${RULES.failedLoginLockMinutes} minutes after ${RULES.failedLoginLockCount} failed login attempts. If this wasn't you, please contact HR.</p>`,
      });
    }
  }

  // ─── Refresh / logout (server-side revocation, Spec §10) ────────────────────

  async refresh(rawToken: string, meta: RequestMeta): Promise<IssuedTokens> {
    const tokenHash = hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing || existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    // Reuse of an already-revoked token => compromise; revoke the whole family.
    if (existing.revokedAt) {
      // Benign-reuse grace (30s): a client that lost a concurrent-refresh race, or
      // was killed before persisting its rotated cookie, replays the just-revoked
      // token. If its replacement has never been used, this is that client — recover
      // by rotating from the replacement instead of nuking the family. A real thief
      // replaying outside this window (or after the successor was used) still trips
      // the family revocation below.
      const GRACE_MS = 30_000;
      const recentlyRevoked = Date.now() - existing.revokedAt.getTime() < GRACE_MS;
      const replacement = recentlyRevoked && existing.replacedById
        ? await this.prisma.refreshToken.findUnique({ where: { id: existing.replacedById } })
        : null;
      if (replacement && !replacement.revokedAt && replacement.expiresAt > new Date()) {
        if (existing.user.status !== 'ACTIVE') throw new UnauthorizedException('Account is not active');
        const next = await this.persistRefreshToken(existing.user.id, existing.familyId, meta);
        await this.prisma.refreshToken.update({
          where: { id: replacement.id },
          data: { revokedAt: new Date(), replacedById: next.id },
        });
        const accessToken = await this.signAccessToken(existing.user);
        return { accessToken, refreshToken: next.rawToken, user: toAuthUser(existing.user) };
      }
      await this.prisma.refreshToken.updateMany({
        where: { familyId: existing.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    if (existing.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }

    // Rotate within the same family.
    const next = await this.persistRefreshToken(existing.user.id, existing.familyId, meta);
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: next.id },
    });

    const accessToken = await this.signAccessToken(existing.user);
    return { accessToken, refreshToken: next.rawToken, user: toAuthUser(existing.user) };
  }

  async logout(rawToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!rawToken) return;
    const tokenHash = hashToken(rawToken);
    const existing = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });
    if (existing && !existing.revokedAt) {
      await this.prisma.refreshToken.update({
        where: { id: existing.id },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        actorId: existing.userId,
        action: 'LOGOUT',
        entityType: 'User',
        entityId: existing.userId,
        ...meta,
      });
    }
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ─── Invite / set-password / reset (Spec §5.1) ─────────────────────────────

  async invite(
    actor: AuthUser,
    input: { email: string; name: string; role: Role; resourceType: ResourceType },
    meta: RequestMeta,
  ): Promise<{ id: string }> {
    const email = input.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const user = await this.prisma.user.create({
      data: {
        email,
        name: input.name.trim(),
        role: input.role,
        resourceType: input.resourceType,
        status: 'INVITED',
      },
    });

    const rawToken = await this.createAuthToken(user.id, 'INVITE', INVITE_TTL_DAYS * 24 * 60);
    const url = `${this.appBaseUrl(user.role)}/set-password?token=${rawToken}`;
    await this.email.enqueue({
      to: email,
      subject: 'You have been invited to Rademics ERP',
      html: `<p>Hi ${escapeHtml(user.name)},</p><p>An account was created for you. Set your password to get started:</p><p><a href="${url}">Set your password</a></p><p>This link expires in ${INVITE_TTL_DAYS} days.</p>`,
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'USER_INVITED',
      entityType: 'User',
      entityId: user.id,
      after: { email, role: input.role, resourceType: input.resourceType },
      ...meta,
    });

    return { id: user.id };
  }

  async setPasswordFromToken(rawToken: string, password: string, meta: RequestMeta): Promise<void> {
    await this.consumePasswordToken(rawToken, 'INVITE', password, 'PASSWORD_SET', meta);
  }

  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Always return success (no enumeration). Only act if the account can log in.
    if (user && user.status === 'ACTIVE') {
      const rawToken = await this.createAuthToken(
        user.id,
        'PASSWORD_RESET',
        RULES.passwordResetLinkMinutes,
      );
      const url = `${this.appBaseUrl(user.role)}/reset-password?token=${rawToken}`;
      await this.email.enqueue({
        to: user.email,
        subject: 'Reset your Rademics ERP password',
        html: `<p>Use the link below to reset your password. It expires in ${RULES.passwordResetLinkMinutes} minutes.</p><p><a href="${url}">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>`,
      });
      await this.audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'User',
        entityId: user.id,
        ...meta,
      });
    }
  }

  async resetPassword(rawToken: string, password: string, meta: RequestMeta): Promise<void> {
    await this.consumePasswordToken(rawToken, 'PASSWORD_RESET', password, 'PASSWORD_RESET', meta);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  private async consumePasswordToken(
    rawToken: string,
    type: 'INVITE' | 'PASSWORD_RESET',
    password: string,
    auditAction: string,
    meta: RequestMeta,
  ): Promise<void> {
    this.assertPasswordStrength(password);
    const tokenHash = hashToken(rawToken);
    const token = await this.prisma.authToken.findUnique({ where: { tokenHash } });
    if (!token || token.type !== type || token.usedAt || token.expiresAt < new Date()) {
      throw new BadRequestException('This link is invalid or has expired');
    }

    const passwordHash = await argonHash(password);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: token.userId },
        data: { passwordHash, status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.authToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
    ]);

    // Password change revokes all sessions (Spec §10).
    await this.revokeAllForUser(token.userId);

    await this.audit.record({
      actorId: token.userId,
      action: auditAction,
      entityType: 'User',
      entityId: token.userId,
      ...meta,
    });
  }

  private assertPasswordStrength(password: string): void {
    if (password.length < RULES.passwordMinLength || !/[0-9]/.test(password)) {
      throw new BadRequestException(
        `Password must be at least ${RULES.passwordMinLength} characters and include a number`,
      );
    }
  }

  private async createAuthToken(
    userId: string,
    type: 'INVITE' | 'PASSWORD_RESET',
    ttlMinutes: number,
  ): Promise<string> {
    const rawToken = generateOpaqueToken();
    await this.prisma.authToken.create({
      data: {
        userId,
        type,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + ttlMinutes * 60_000),
      },
    });
    return rawToken;
  }

  private async issueTokens(
    user: {
      id: string;
      email: string;
      role: Role;
      resourceType: ResourceType;
      desktopCheckInRequired: boolean;
    },
    meta: RequestMeta,
  ): Promise<IssuedTokens> {
    const familyId = randomUUID();
    const refresh = await this.persistRefreshToken(user.id, familyId, meta);
    const accessToken = await this.signAccessToken(user);
    return { accessToken, refreshToken: refresh.rawToken, user: toAuthUser(user) };
  }

  private async persistRefreshToken(
    userId: string,
    familyId: string,
    meta: RequestMeta,
  ): Promise<{ id: string; rawToken: string }> {
    const rawToken = generateOpaqueToken();
    const ttlMs = parseDurationMs(this.config.get<string>('JWT_REFRESH_TTL', '7d'));
    const row = await this.prisma.refreshToken.create({
      data: {
        userId,
        familyId,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + ttlMs),
        createdByIp: meta.ip ?? null,
        userAgent: meta.userAgent ?? null,
      },
      select: { id: true },
    });
    return { id: row.id, rawToken };
  }

  private signAccessToken(user: {
    id: string;
    email: string;
    role: Role;
    resourceType: ResourceType;
    desktopCheckInRequired: boolean;
  }): Promise<string> {
    return this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        resourceType: user.resourceType,
        desktopCheckInRequired: user.desktopCheckInRequired,
      },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: this.config.get<string>('JWT_ACCESS_TTL', '15m'),
      },
    );
  }

  private appBaseUrl(role: Role): string {
    return role === Role.CLIENT
      ? this.config.get<string>('PORTAL_APP_URL', 'http://localhost:3001')
      : this.config.get<string>('INTERNAL_APP_URL', 'http://localhost:3000');
  }
}

function toAuthUser(u: {
  id: string;
  email: string;
  role: Role;
  resourceType: ResourceType;
  desktopCheckInRequired: boolean;
}): AuthUser {
  return {
    id: u.id,
    email: u.email,
    role: u.role,
    resourceType: u.resourceType,
    desktopCheckInRequired: u.desktopCheckInRequired,
  };
}

function parseDurationMs(input: string): number {
  const m = /^(\d+)([smhd])$/.exec(input.trim());
  if (!m) return 7 * 24 * 60 * 60_000;
  const value = Number(m[1]);
  const unit = m[2];
  const mult = unit === 's' ? 1_000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return value * mult;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}
