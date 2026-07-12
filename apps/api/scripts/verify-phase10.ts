/**
 * Phase 10 (Hardening) end-to-end verification against the RUNNING API.
 *
 * Proves the Phase-10 security + retention surface (Spec §10, §11, §25):
 *  - Data-retention jobs: notification 90-day purge + monitoring-data 12-month purge,
 *    both hard-delete only past the window, keep recent rows, and write an audit entry.
 *  - Fail-closed RBAC: no token → 401; authenticated-but-uncapable → 403.
 *  - Session isolation: a client token cannot reach internal endpoints and an internal
 *    token cannot reach portal endpoints (§5.1).
 *  - Auth rate limit: repeated bad logins lock the account (§5.1).
 *  - AI rate limit: exceeding the per-user daily counter → 429 (§7, §10).
 *  - UUID-only identifiers: ids are UUIDs; a bogus/absent id never returns data (§10).
 *  - Secrets stay server-side: server env secrets never appear in an API response (§10).
 *  - Observability: /metrics scrapes Prometheus text; strict CSP header on responses;
 *    the Sentry test-error endpoint is capability-gated (§11).
 *
 * Run (API + docker stack must be up): pnpm --filter @rademics/api verify:phase10
 */
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';

const prisma = new PrismaClient();
const BASE = `http://127.0.0.1:${process.env.API_PORT ?? 4000}/api`;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}

async function req(
  path: string,
  opts: { method?: string; token?: string; body?: unknown } = {},
): Promise<{ status: number; json: any; headers: Headers }> {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-JSON (e.g. metrics) */ }
  return { status: res.status, json, headers: res.headers };
}

const login = async (email: string, password: string) =>
  (await req('/auth/login', { method: 'POST', body: { email, password } })).json?.accessToken as string;

async function ensureUser(
  email: string,
  role: string,
  password: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const u = await prisma.user.upsert({
    where: { email },
    update: { status: 'ACTIVE', role: role as any, passwordHash: await argonHash(password), lockedUntil: null, failedLoginCount: 0, ...extra },
    create: { email, name: email.split('@')[0], role: role as any, resourceType: 'INTERNAL', status: 'ACTIVE', passwordHash: await argonHash(password), ...extra },
    select: { id: true },
  });
  return u.id;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

async function main(): Promise<void> {
  console.log(`Verifying Phase 10 against ${BASE}\n`);
  const stamp = Date.now();
  const pw = 'Passw0rd!123';

  const saEmail = `p10.sa.${stamp}@rademics.local`;
  const empEmail = `p10.emp.${stamp}@rademics.local`;
  const clientEmail = `p10.client.${stamp}@rademics.local`;

  const saId = await ensureUser(saEmail, 'SUPER_ADMIN', pw);
  const empId = await ensureUser(empEmail, 'EMPLOYEE', pw);

  const org = await prisma.clientOrg.create({ data: { name: `P10 Org ${stamp}`, status: 'ACTIVE' } });
  const clientId = await ensureUser(clientEmail, 'CLIENT', pw, { resourceType: 'INTERNAL', clientOrgId: org.id });

  const saToken = await login(saEmail, pw);
  const empToken = await login(empEmail, pw);
  const clientToken = await login(clientEmail, pw);
  check('seed logins succeed (SA, EMPLOYEE, CLIENT)', Boolean(saToken && empToken && clientToken));

  // ── 1. Data-retention jobs (§10, §25) ──
  console.log('\n[Retention]');
  const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // > 90 days
  const oldNotif = await prisma.notification.create({
    data: { userId: empId, type: 'TEST_OLD', title: 'old', createdAt: oldDate },
  });
  const freshNotif = await prisma.notification.create({
    data: { userId: empId, type: 'TEST_FRESH', title: 'fresh' },
  });
  const oldSessionAt = new Date();
  oldSessionAt.setMonth(oldSessionAt.getMonth() - 13); // > 12 months
  const oldSession = await prisma.attendanceSession.create({
    data: { userId: empId, checkInAt: oldSessionAt, checkOutAt: oldSessionAt },
  });
  const freshSession = await prisma.attendanceSession.create({
    data: { userId: empId, checkInAt: new Date() },
  });

  const auditBefore = await prisma.auditLog.count({
    where: { action: { in: ['RETENTION_NOTIFICATION_PURGE', 'RETENTION_MONITORING_PURGE'] } },
  });

  const runNoAuth = await req('/admin/retention/run', { method: 'POST' });
  check('retention trigger requires auth (401 without token)', runNoAuth.status === 401, `got ${runNoAuth.status}`);
  const runAsEmp = await req('/admin/retention/run', { method: 'POST', token: empToken });
  check('retention trigger fail-closed for EMPLOYEE (403)', runAsEmp.status === 403, `got ${runAsEmp.status}`);

  const run = await req('/admin/retention/run', { method: 'POST', token: saToken });
  check('retention run returns 200/201 for SA', run.status === 200 || run.status === 201, `got ${run.status}`);
  check('retention reports ≥1 notification deleted', (run.json?.notificationsDeleted ?? 0) >= 1, JSON.stringify(run.json));
  check('retention reports ≥1 monitoring session deleted', (run.json?.monitoringSessionsDeleted ?? 0) >= 1, JSON.stringify(run.json));

  const oldNotifGone = !(await prisma.notification.findUnique({ where: { id: oldNotif.id } }));
  const freshNotifKept = Boolean(await prisma.notification.findUnique({ where: { id: freshNotif.id } }));
  check('notification > 90d hard-deleted', oldNotifGone);
  check('notification < 90d retained', freshNotifKept);

  const oldSessionGone = !(await prisma.attendanceSession.findUnique({ where: { id: oldSession.id } }));
  const freshSessionKept = Boolean(await prisma.attendanceSession.findUnique({ where: { id: freshSession.id } }));
  check('monitoring session > 12mo hard-deleted', oldSessionGone);
  check('monitoring session < 12mo retained', freshSessionKept);

  const auditAfter = await prisma.auditLog.count({
    where: { action: { in: ['RETENTION_NOTIFICATION_PURGE', 'RETENTION_MONITORING_PURGE'] } },
  });
  check('retention deletions are audit-logged (§10)', auditAfter >= auditBefore + 2, `before ${auditBefore} after ${auditAfter}`);

  // ── 2. Fail-closed RBAC (§10) ──
  console.log('\n[Fail-closed RBAC]');
  const noToken = await req('/employees');
  check('business endpoint w/o token → 401', noToken.status === 401, `got ${noToken.status}`);
  const empSettings = await req('/settings/business-rules', { token: empToken });
  check('EMPLOYEE → admin settings → 403', empSettings.status === 403, `got ${empSettings.status}`);
  const saSettings = await req('/settings/business-rules', { token: saToken });
  check('SA → admin settings → 200', saSettings.status === 200, `got ${saSettings.status}`);

  // ── 3. Session isolation (§5.1) ──
  console.log('\n[Session isolation]');
  const clientHitsInternal = await req('/employees', { token: clientToken });
  check('CLIENT token cannot reach internal /employees (401/403)', clientHitsInternal.status === 401 || clientHitsInternal.status === 403, `got ${clientHitsInternal.status}`);
  const empHitsPortal = await req('/portal/projects', { token: empToken });
  check('EMPLOYEE token cannot reach /portal (401/403)', empHitsPortal.status === 401 || empHitsPortal.status === 403, `got ${empHitsPortal.status}`);

  // ── 4. Auth rate limit / lockout (§5.1) ──
  console.log('\n[Auth rate limit]');
  const lockEmail = `p10.lock.${stamp}@rademics.local`;
  await ensureUser(lockEmail, 'EMPLOYEE', pw);
  for (let i = 0; i < 5; i++) {
    await req('/auth/login', { method: 'POST', body: { email: lockEmail, password: 'wrong-password' } });
  }
  const afterLock = await req('/auth/login', { method: 'POST', body: { email: lockEmail, password: pw } });
  const lockedUser = await prisma.user.findUnique({ where: { email: lockEmail }, select: { lockedUntil: true } });
  check('5 bad logins lock the account (correct pw now refused)', afterLock.status === 401, `got ${afterLock.status}`);
  check('lockedUntil is set in the future', Boolean(lockedUser?.lockedUntil && lockedUser.lockedUntil > new Date()));

  // ── 5. AI rate limit (§7, §10) ──
  console.log('\n[AI rate limit]');
  const rules = (saSettings.json ?? {}) as Record<string, unknown>;
  const aiLimit = Number(rules.aiDailyCallLimitPerUser ?? 50);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0); // match the service's UTC daily-counter key
  await prisma.aiUsage.upsert({
    where: { userId_date: { userId: saId, date: today } },
    update: { count: aiLimit },
    create: { userId: saId, date: today, count: aiLimit },
  });
  const aiOverLimit = await req('/ai/chat', { method: 'POST', token: saToken, body: { question: 'what is overdue?' } });
  check('AI call over daily limit → 429', aiOverLimit.status === 429, `got ${aiOverLimit.status}`);

  // ── 6. UUID-only identifiers (§10) ──
  console.log('\n[UUID enforcement]');
  check('user ids are UUIDs (no sequential exposure)', UUID_RE.test(saId) && UUID_RE.test(clientId));
  const bogusId = await req(`/employees/not-a-real-id`, { token: saToken });
  check('non-UUID id never returns data (≥400)', bogusId.status >= 400, `got ${bogusId.status}`);
  const missingId = await req(`/employees/${ZERO_UUID}`, { token: saToken });
  check('unknown UUID → not found (enumeration impossible)', missingId.status === 404 || missingId.status === 403, `got ${missingId.status}`);

  // ── 7. Secrets stay server-side (§10) ──
  console.log('\n[Secrets server-side]');
  const secretsToCheck = [process.env.JWT_ACCESS_SECRET, process.env.JWT_REFRESH_SECRET, process.env.FIELD_ENCRYPTION_KEY]
    .filter((s): s is string => Boolean(s) && (s as string).length >= 8);
  const settingsBody = JSON.stringify(saSettings.json ?? {});
  const meBody = JSON.stringify((await req('/auth/me', { token: saToken })).json ?? {});
  const leaks = secretsToCheck.filter((s) => settingsBody.includes(s) || meBody.includes(s));
  check('server env secrets never appear in API responses', leaks.length === 0, `leaked ${leaks.length}`);
  check('admin settings expose no *secret/*password/*key value field', !/"[^"]*(secret|password|apikey|api_key)[^"]*"\s*:\s*"[^"]+"/i.test(settingsBody));

  // ── 8. Observability (§11) ──
  console.log('\n[Observability]');
  const metrics = await req('/metrics');
  check('GET /metrics → 200', metrics.status === 200, `got ${metrics.status}`);
  const metricsText = await (await fetch(`${BASE}/metrics`)).text();
  check('/metrics emits Prometheus counters', metricsText.includes('http_requests_total'));
  const health = await req('/health');
  const csp = health.headers.get('content-security-policy') ?? '';
  check("API sends strict CSP (default-src 'none')", csp.includes("default-src 'none'"), csp);
  const sentryNoAuth = await req('/health/debug-sentry');
  check('Sentry test endpoint requires auth (401)', sentryNoAuth.status === 401, `got ${sentryNoAuth.status}`);
  const sentryAsEmp = await req('/health/debug-sentry', { token: empToken });
  check('Sentry test endpoint fail-closed for EMPLOYEE (403)', sentryAsEmp.status === 403, `got ${sentryAsEmp.status}`);

  console.log(`\n${failed === 0 ? '✅' : '❌'} Phase 10: ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
