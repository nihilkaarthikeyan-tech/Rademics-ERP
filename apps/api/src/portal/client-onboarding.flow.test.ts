/**
 * End-to-end LOGIC test for the client-onboarding story (Spec §2, §5.5):
 *
 *   Super Admin creates the client "id" (a Client Org)
 *     → invites a client user (login created, invite email sent)
 *     → client sets a password and logs into the Portal
 *     → Super Admin grants that client access to a project
 *     → deactivating the org ends all access.
 *
 * It drives the REAL AuthService + ClientAdminService (real password hashing,
 * real JWT signing, real invite/permission logic) against an in-memory fake of
 * the database, so it runs offline in seconds with no Postgres/Redis/browser.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { PERMISSION_MATRIX, Grant } from '@rademics/permissions';
import { AuthService } from '../auth/auth.service';
import { ClientAdminService } from './client-admin.service';
import type { AuthUser } from '../auth/auth-user';

// ── Tiny in-memory database (only the bits these services touch) ──────────────
function makeDb() {
  return {
    users: new Map<string, any>(),
    clientOrgs: new Map<string, any>(),
    authTokens: new Map<string, any>(),
    refreshTokens: new Map<string, any>(),
    projects: new Map<string, any>(),
    cpa: new Map<string, any>(), // clientProjectAccess
  };
}

let seq = 0;
const genId = (p: string) => `${p}_${++seq}`;

function pick(obj: any, select?: Record<string, boolean>) {
  if (!select) return { ...obj };
  const out: any = {};
  for (const k of Object.keys(select)) if (select[k]) out[k] = obj[k];
  return out;
}

function makePrisma(db: ReturnType<typeof makeDb>) {
  const findUser = (where: any) =>
    where.id
      ? db.users.get(where.id)
      : [...db.users.values()].find((u) => u.email === where.email);

  return {
    $transaction: (ops: Promise<any>[]) => Promise.all(ops),

    user: {
      findUnique: async ({ where }: any) => {
        const u = findUser(where);
        return u ? { ...u } : null;
      },
      create: async ({ data }: any) => {
        const u = {
          id: genId('user'),
          passwordHash: null,
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: null,
          clientOrgId: null,
          ...data,
          email: data.email.toLowerCase(),
        };
        db.users.set(u.id, u);
        return { ...u };
      },
      update: async ({ where, data, select }: any) => {
        const u = db.users.get(where.id);
        if (!u) throw new Error('user not found');
        for (const [k, v] of Object.entries<any>(data)) {
          if (v && typeof v === 'object' && 'increment' in v) u[k] = (u[k] ?? 0) + v.increment;
          else u[k] = v;
        }
        return pick(u, select);
      },
    },

    clientOrg: {
      create: async ({ data }: any) => {
        const o = { id: genId('org'), status: 'ACTIVE', ...data };
        db.clientOrgs.set(o.id, o);
        return { ...o };
      },
      findUnique: async ({ where, select }: any) => {
        const o = db.clientOrgs.get(where.id);
        if (!o) return null;
        const base: any = { ...o };
        if (select?.users) {
          base.users = [...db.users.values()]
            .filter((u) => u.clientOrgId === o.id)
            .map((u) => ({ id: u.id }));
        }
        return base;
      },
      update: async ({ where, data }: any) => {
        const o = db.clientOrgs.get(where.id);
        Object.assign(o, data);
        return { ...o };
      },
    },

    authToken: {
      create: async ({ data }: any) => {
        const t = { id: genId('tok'), usedAt: null, ...data };
        db.authTokens.set(t.id, t);
        return { ...t };
      },
      findUnique: async ({ where }: any) => {
        const t = [...db.authTokens.values()].find((x) => x.tokenHash === where.tokenHash);
        return t ? { ...t } : null;
      },
      update: async ({ where, data }: any) => {
        const t = db.authTokens.get(where.id);
        Object.assign(t, data);
        return { ...t };
      },
    },

    refreshToken: {
      create: async ({ data, select }: any) => {
        const r = { id: genId('rt'), revokedAt: null, ...data };
        db.refreshTokens.set(r.id, r);
        return pick(r, select);
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const r of db.refreshTokens.values()) {
          if (r.userId === where.userId && (where.revokedAt === null ? !r.revokedAt : true)) {
            Object.assign(r, data);
            count++;
          }
        }
        return { count };
      },
    },

    project: {
      findUnique: async ({ where }: any) => {
        const p = db.projects.get(where.id);
        return p ? { ...p } : null;
      },
      update: async ({ where, data }: any) => {
        const p = db.projects.get(where.id);
        Object.assign(p, data);
        return { ...p };
      },
    },

    clientProjectAccess: {
      upsert: async ({ where, update, create }: any) => {
        const key = where.projectId_clientUserId;
        const existing = [...db.cpa.values()].find(
          (a) => a.projectId === key.projectId && a.clientUserId === key.clientUserId,
        );
        if (existing) {
          Object.assign(existing, update);
          return { ...existing };
        }
        const rec = { id: genId('cpa'), ...create };
        db.cpa.set(rec.id, rec);
        return { ...rec };
      },
    },
  };
}

// ── Test harness ──────────────────────────────────────────────────────────────
const SA: AuthUser = {
  id: 'sa_1',
  email: 'admin@rademics.local',
  role: 'SUPER_ADMIN',
  resourceType: 'INTERNAL',
  desktopCheckInRequired: false,
};
const meta = { ip: '127.0.0.1', userAgent: 'vitest' };
const CLIENT_PASSWORD = 'ClientPass123'; // ≥10 chars + a number

function build() {
  const db = makeDb();
  const prisma = makePrisma(db) as any;
  const emails: any[] = [];
  const audits: any[] = [];
  const email = { enqueue: async (m: any) => void emails.push(m) } as any;
  const audit = { record: async (e: any) => void audits.push(e) } as any;
  const config = {
    get: (_k: string, d?: any) => d,
    getOrThrow: (_k: string) => 'test-access-secret',
  } as any;
  const jwt = new JwtService({});
  const auth = new AuthService(prisma, jwt, config, audit, email);
  const clientAdmin = new ClientAdminService(prisma, audit, auth);
  return { db, emails, audits, auth, clientAdmin };
}

function tokenFromInvite(html: string): string {
  const m = /set-password\?token=([^"&]+)/.exec(html);
  if (!m) throw new Error('no invite token in email: ' + html);
  return m[1];
}

// ── The story, step by step ───────────────────────────────────────────────────
describe('Client onboarding: Super Admin → client login → project access', () => {
  it('creates a Client Org (the client "id")', async () => {
    const { clientAdmin } = build();
    const org = await clientAdmin.createOrg({ name: 'Acme Ltd' }, SA, meta);
    expect(org.name).toBe('Acme Ltd');
    expect(org.status).toBe('ACTIVE');
  });

  it('invites a client user: login is created (role CLIENT, bound to org) and a PORTAL invite email is sent', async () => {
    const { clientAdmin, db, emails } = build();
    const org = await clientAdmin.createOrg({ name: 'Acme Ltd' }, SA, meta);

    const created = await clientAdmin.createClientUser(
      org.id,
      { email: 'cara@acme.com', name: 'Cara Client' },
      SA,
      meta,
    );

    const row = db.users.get(created.id);
    expect(row.role).toBe('CLIENT');
    expect(row.status).toBe('INVITED'); // cannot log in yet
    expect(row.clientOrgId).toBe(org.id); // scoped to this client's org

    const invite = emails.find((e) => e.to === 'cara@acme.com');
    expect(invite).toBeTruthy();
    expect(invite.html).toContain('localhost:3001'); // Portal URL, not the staff app
  });

  it('BLOCKS login before the password is set', async () => {
    const { clientAdmin, auth } = build();
    const org = await clientAdmin.createOrg({ name: 'Acme Ltd' }, SA, meta);
    await clientAdmin.createClientUser(org.id, { email: 'cara@acme.com', name: 'Cara' }, SA, meta);

    await expect(auth.login('cara@acme.com', CLIENT_PASSWORD, meta)).rejects.toThrow(
      /invalid email or password/i,
    );
  });

  it('lets the client set a password and LOG IN to the portal', async () => {
    const { clientAdmin, auth, db, emails } = build();
    const org = await clientAdmin.createOrg({ name: 'Acme Ltd' }, SA, meta);
    const created = await clientAdmin.createClientUser(
      org.id,
      { email: 'cara@acme.com', name: 'Cara' },
      SA,
      meta,
    );

    const token = tokenFromInvite(emails[0].html);
    await auth.setPasswordFromToken(token, CLIENT_PASSWORD, meta);
    expect(db.users.get(created.id).status).toBe('ACTIVE');

    const session = await auth.login('cara@acme.com', CLIENT_PASSWORD, meta);
    expect(session.accessToken).toBeTruthy();
    expect(session.refreshToken).toBeTruthy();
    expect(session.user.role).toBe('CLIENT');
  });

  it('REJECTS a wrong password after activation', async () => {
    const { clientAdmin, auth, emails } = build();
    const org = await clientAdmin.createOrg({ name: 'Acme Ltd' }, SA, meta);
    await clientAdmin.createClientUser(org.id, { email: 'cara@acme.com', name: 'Cara' }, SA, meta);
    await auth.setPasswordFromToken(tokenFromInvite(emails[0].html), CLIENT_PASSWORD, meta);

    await expect(auth.login('cara@acme.com', 'WrongPass999', meta)).rejects.toThrow();
  });

  it('grants the client APPROVER access to a project and binds the project to the org', async () => {
    const { clientAdmin, db } = build();
    const org = await clientAdmin.createOrg({ name: 'Acme Ltd' }, SA, meta);
    const created = await clientAdmin.createClientUser(
      org.id,
      { email: 'cara@acme.com', name: 'Cara' },
      SA,
      meta,
    );
    db.projects.set('p1', { id: 'p1', clientOrgId: null });

    const access = await clientAdmin.grantAccess(
      'p1',
      { clientUserId: created.id, level: 'APPROVER' },
      SA,
      meta,
    );
    expect(access.level).toBe('APPROVER');
    expect(db.projects.get('p1').clientOrgId).toBe(org.id); // project now locked to this client
  });

  it('refuses to grant client access to a non-client (e.g. an employee) account', async () => {
    const { clientAdmin, db } = build();
    db.projects.set('p1', { id: 'p1', clientOrgId: null });
    db.users.set('emp1', { id: 'emp1', role: 'EMPLOYEE', clientOrgId: null });

    await expect(
      clientAdmin.grantAccess('p1', { clientUserId: 'emp1', level: 'VIEWER' }, SA, meta),
    ).rejects.toThrow(/not a client-org user/i);
  });

  it('ends all access when the org is deactivated', async () => {
    const { clientAdmin, auth, db, emails } = build();
    const org = await clientAdmin.createOrg({ name: 'Acme Ltd' }, SA, meta);
    await clientAdmin.createClientUser(org.id, { email: 'cara@acme.com', name: 'Cara' }, SA, meta);
    await auth.setPasswordFromToken(tokenFromInvite(emails[0].html), CLIENT_PASSWORD, meta);
    await auth.login('cara@acme.com', CLIENT_PASSWORD, meta); // creates a refresh session

    const result = await clientAdmin.deactivateOrg(org.id, SA, meta);
    expect(result.status).toBe('DEACTIVATED');
    expect(db.clientOrgs.get(org.id).status).toBe('DEACTIVATED');
    // every refresh session for the client is revoked
    const clientUser = [...db.users.values()].find((u) => u.email === 'cara@acme.com');
    const sessions = [...db.refreshTokens.values()].filter((r) => r.userId === clientUser.id);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((r) => r.revokedAt)).toBe(true);
  });
});

// ── The permission rules that decide WHO can do the above ─────────────────────
describe('Permission matrix: who can manage clients vs. use the portal', () => {
  it('ONLY Super Admin can create/manage client logins', () => {
    const cap = PERMISSION_MATRIX['portal.users.manage'];
    expect(cap.SUPER_ADMIN).toBe(Grant.ALLOW);
    expect(cap.HR).toBe(Grant.DENY);
    expect(cap.PM).toBe(Grant.DENY);
    expect(cap.EMPLOYEE).toBe(Grant.DENY);
    expect(cap.CLIENT).toBe(Grant.DENY);
    expect(cap.FINANCE).toBe(Grant.DENY);
  });

  it('ONLY the Client role can view the portal, and staff cannot', () => {
    const view = PERMISSION_MATRIX['portal.progress.view'];
    expect(view.CLIENT).toBe(Grant.ALLOW);
    expect(view.SUPER_ADMIN).toBe(Grant.DENY);
    expect(view.EMPLOYEE).toBe(Grant.DENY);
  });

  it('only a client can approve a deliverable, and only when scoped (Approver on that project)', () => {
    const approve = PERMISSION_MATRIX['portal.deliverable.approve'];
    expect(approve.CLIENT).toBe(Grant.SCOPED);
    expect(approve.PM).toBe(Grant.DENY);
  });
});
