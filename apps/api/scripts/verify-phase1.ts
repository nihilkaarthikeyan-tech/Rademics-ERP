/**
 * Phase 1 end-to-end verification (phase.md Phase 1 "Done" + Spec §13 Auth & RBAC).
 *
 * Proves against the RUNNING API:
 *   1. Auth is enforced        — /auth/me without a token -> 401
 *   2. Authenticated access     — /auth/me with a token   -> 200, correct role
 *   3. Capability ALLOW         — Super Admin can POST /auth/invite
 *   4. Capability DENY (§10)    — Employee POST /auth/invite -> 403 (verified at the API)
 *   5. Audit trail (§5.10)      — LOGIN_SUCCESS + USER_INVITED rows exist
 *
 * Requires the API running on API_PORT and Postgres up. Run: pnpm --filter @rademics/api verify:phase1
 */
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';

const prisma = new PrismaClient();
const BASE = `http://127.0.0.1:${process.env.API_PORT ?? 4000}/api`;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

async function req(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, json };
}

async function main(): Promise<void> {
  console.log(`Verifying Phase 1 against ${BASE}\n`);

  // Arrange: an ACTIVE employee we can log in as (bypasses the emailed invite token).
  const empEmail = 'verify.employee@rademics.local';
  await prisma.user.upsert({
    where: { email: empEmail },
    update: { status: 'ACTIVE', passwordHash: await argonHash('Employee123!') },
    create: {
      email: empEmail,
      name: 'Verify Employee',
      role: 'EMPLOYEE',
      resourceType: 'INTERNAL',
      status: 'ACTIVE',
      passwordHash: await argonHash('Employee123!'),
    },
  });

  // 0. Health (public)
  const health = await req('/health');
  check('health endpoint is public and up', health.status === 200 && health.json?.db === 'up');

  // 1. Auth enforced
  const meNoToken = await req('/auth/me');
  check('GET /auth/me without token -> 401', meNoToken.status === 401, `(got ${meNoToken.status})`);

  // 2. Super Admin login
  const saLogin = await req('/auth/login', {
    method: 'POST',
    body: { email: 'admin@rademics.local', password: 'ChangeMe123!' },
  });
  const saToken = saLogin.json?.accessToken as string | undefined;
  check('Super Admin login -> 200 + accessToken', saLogin.status === 200 && !!saToken);

  // Authenticated access
  const meSa = await req('/auth/me', { token: saToken });
  check('GET /auth/me with token -> 200, role SUPER_ADMIN', meSa.status === 200 && meSa.json?.role === 'SUPER_ADMIN');

  // 3. Capability ALLOW: Super Admin can invite
  const inviteEmail = `invitee.${Date.now()}@rademics.local`;
  const saInvite = await req('/auth/invite', {
    method: 'POST',
    token: saToken,
    body: { email: inviteEmail, name: 'Invited User', role: 'EMPLOYEE', resourceType: 'INTERNAL' },
  });
  check('Super Admin POST /auth/invite -> 2xx (capability ALLOW)', saInvite.status >= 200 && saInvite.status < 300, `(got ${saInvite.status})`);

  // Employee login
  const empLogin = await req('/auth/login', {
    method: 'POST',
    body: { email: empEmail, password: 'Employee123!' },
  });
  const empToken = empLogin.json?.accessToken as string | undefined;
  check('Employee login -> 200 + accessToken', empLogin.status === 200 && !!empToken);

  // 4. Capability DENY at the API: Employee cannot invite
  const empInvite = await req('/auth/invite', {
    method: 'POST',
    token: empToken,
    body: { email: `x.${Date.now()}@rademics.local`, name: 'X', role: 'EMPLOYEE', resourceType: 'INTERNAL' },
  });
  check('Employee POST /auth/invite -> 403 (RBAC DENY at API, §10)', empInvite.status === 403, `(got ${empInvite.status})`);

  // Wrong password increments failed-login + audit
  await req('/auth/login', { method: 'POST', body: { email: empEmail, password: 'wrong-password' } });

  // 5. Audit trail
  const loginSuccess = await prisma.auditLog.count({ where: { action: 'LOGIN_SUCCESS' } });
  const userInvited = await prisma.auditLog.count({ where: { action: 'USER_INVITED' } });
  const loginFailed = await prisma.auditLog.count({ where: { action: 'LOGIN_FAILED' } });
  check('audit: LOGIN_SUCCESS rows exist (§5.10)', loginSuccess > 0, `(count ${loginSuccess})`);
  check('audit: USER_INVITED rows exist (§5.10)', userInvited > 0, `(count ${userInvited})`);
  check('audit: LOGIN_FAILED rows exist (§5.10)', loginFailed > 0, `(count ${loginFailed})`);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
