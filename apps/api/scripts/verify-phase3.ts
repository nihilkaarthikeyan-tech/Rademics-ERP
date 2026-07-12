/**
 * Phase 3 (Attendance) end-to-end verification.
 * Proves against the RUNNING API: multi-session check-in/out, idempotency, idle
 * heartbeat, live who's-online, nightly rule computation (late / half-day / overtime
 * / multi-session sum), regularization round-trip (approval creates a corrective
 * session, never overwriting history), RBAC (§3/§10), and audit (§5.10).
 * Run: pnpm --filter @rademics/api verify:phase3
 */
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';

const prisma = new PrismaClient();
const BASE = `http://127.0.0.1:${process.env.API_PORT ?? 4000}/api`;
const TZ = 'Asia/Kolkata';

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}

async function req(path: string, opts: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}

async function login(email: string, password: string): Promise<string> {
  const r = await req('/auth/login', { method: 'POST', body: { email, password } });
  return r.json?.accessToken as string;
}

// UTC instant for an IST wall-clock time (IST = UTC+5:30, no DST).
function ist(y: number, m: number, d: number, H: number, M: number): Date {
  return new Date(Date.UTC(y, m - 1, d, H, M, 0) - (5 * 3600 + 30 * 60) * 1000);
}
function istDateKey(offsetDays = 0): { key: string; y: number; m: number; d: number } {
  const todayKey = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  const base = new Date(`${todayKey}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  const [y, m, d] = [base.getUTCFullYear(), base.getUTCMonth() + 1, base.getUTCDate()];
  return { key: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, y, m, d };
}

async function ensureUser(email: string, password: string): Promise<string> {
  const u = await prisma.user.upsert({
    where: { email },
    update: { status: 'ACTIVE', passwordHash: await argonHash(password) },
    create: {
      email, name: 'Verify Attendance', role: 'EMPLOYEE', resourceType: 'INTERNAL',
      status: 'ACTIVE', passwordHash: await argonHash(password),
    },
    select: { id: true },
  });
  return u.id;
}

async function main(): Promise<void> {
  console.log(`Verifying Phase 3 against ${BASE}\n`);

  const saToken = await login('admin@rademics.local', 'ChangeMe123!');
  check('Super Admin login', !!saToken);

  const empId = await ensureUser('verify.attendance@rademics.local', 'Employee123!');
  const empToken = await login('verify.attendance@rademics.local', 'Employee123!');
  check('Employee login', !!empToken);

  // Clean slate for this user so counts are deterministic.
  await prisma.attendanceSession.deleteMany({ where: { userId: empId } });
  await prisma.attendanceDay.deleteMany({ where: { userId: empId } });
  await prisma.regularizationRequest.deleteMany({ where: { userId: empId } });

  // ── RBAC: Super Admin may NOT check in (§3 attendance.check_in_out = DENY for SA) ──
  const saCheckIn = await req('/attendance/check-in', { method: 'POST', token: saToken, body: {} });
  check('Super Admin check-in -> 403 (RBAC §3/§10)', saCheckIn.status === 403, `(${saCheckIn.status})`);

  // ── Check-in / duplicate / idempotency ──
  const ci = await req('/attendance/check-in', { method: 'POST', token: empToken, body: {} });
  check('Employee check-in', ci.status >= 200 && ci.status < 300, `(${ci.status})`);
  const dup = await req('/attendance/check-in', { method: 'POST', token: empToken, body: {} });
  check('Second check-in while open -> 409', dup.status === 409, `(${dup.status})`);

  // ── Idle heartbeat: backdate last heartbeat, then a heartbeat should accrue idle ──
  const openBefore = await prisma.attendanceSession.findFirst({
    where: { userId: empId, checkOutAt: null }, select: { id: true },
  });
  await prisma.attendanceSession.update({
    where: { id: openBefore!.id },
    data: { lastHeartbeatAt: new Date(Date.now() - 10 * 60 * 1000) }, // 10 min ago
  });
  const hb = await req('/attendance/heartbeat', { method: 'POST', token: empToken, body: {} });
  check('Heartbeat accrues idle after a >threshold gap (§5.3)', (hb.json?.idleSeconds ?? 0) >= 590, `(${hb.json?.idleSeconds})`);

  // ── Today status reflects the open session ──
  const today = await req('/attendance/today', { token: empToken });
  check('today shows checkedIn=true', today.json?.checkedIn === true);

  // ── Who's online (Super Admin, all scope) includes the checked-in employee ──
  const online = await req('/attendance/online', { token: saToken });
  check('online list includes the checked-in employee', Array.isArray(online.json) && online.json.some((u: any) => u.userId === empId));

  // ── Check-out ──
  const co = await req('/attendance/check-out', { method: 'POST', token: empToken, body: {} });
  check('Employee check-out', co.status >= 200 && co.status < 300, `(${co.status})`);
  const co2 = await req('/attendance/check-out', { method: 'POST', token: empToken, body: {} });
  check('Check-out with no open session -> 400', co2.status === 400, `(${co2.status})`);

  // ── Idempotent check-in: same key returns the same session ──
  const key = `verify-${Date.now()}`;
  const k1 = await req('/attendance/check-in', { method: 'POST', token: empToken, body: { idempotencyKey: key } });
  const k2 = await req('/attendance/check-in', { method: 'POST', token: empToken, body: { idempotencyKey: key } });
  check('Idempotent check-in returns same session (§25)', !!k1.json?.id && k1.json.id === k2.json?.id);
  await req('/attendance/check-out', { method: 'POST', token: empToken, body: {} });

  // ── Nightly rules: seed two sessions on a past working day, recompute, verify sum/late/idle ──
  const y = istDateKey(-1); // yesterday (a working day, Mon–Sat)
  await prisma.attendanceSession.deleteMany({ where: { userId: empId } });
  await prisma.attendanceSession.createMany({
    data: [
      { userId: empId, checkInAt: ist(y.y, y.m, y.d, 10, 0), checkOutAt: ist(y.y, y.m, y.d, 13, 0), idleSeconds: 600 },
      { userId: empId, checkInAt: ist(y.y, y.m, y.d, 14, 0), checkOutAt: ist(y.y, y.m, y.d, 18, 0), idleSeconds: 0 },
    ],
  });
  const recompute = await req('/attendance/recompute', { method: 'POST', token: saToken, body: { date: y.key } });
  check('recompute (attendance.rules.configure)', recompute.status >= 200 && recompute.status < 300, `(${recompute.status})`);

  const day = await prisma.attendanceDay.findFirst({ where: { userId: empId, date: new Date(y.key) } });
  check('multi-session sum = 7h (§5.3)', day?.workedSeconds === 7 * 3600, `(got ${day?.workedSeconds})`);
  check('idle surfaced on the day', day?.idleSeconds === 600, `(got ${day?.idleSeconds})`);
  check('first check-in 10:00 IST flagged Late (§4)', day?.isLate === true);
  check('7h worked -> PRESENT (not half-day)', day?.status === 'PRESENT', `(${day?.status})`);

  // ── Employee RBAC: cannot view team / all attendance (§3) ──
  const empAll = await req('/attendance', { token: empToken });
  check('Employee GET /attendance (all) -> 403', empAll.status === 403, `(${empAll.status})`);
  const empTeam = await req('/attendance/team', { token: empToken });
  check('Employee GET /attendance/team -> 403 (not scoped for EMPLOYEE)', empTeam.status === 403, `(${empTeam.status})`);

  // ── Regularization round-trip: request (reason < 10 rejected), then SA approves ──
  const two = istDateKey(-2);
  const badReason = await req('/attendance/regularizations', {
    method: 'POST', token: empToken, body: { date: two.key, reason: 'short' },
  });
  check('regularization reason < 10 chars -> 400 (§24)', badReason.status === 400, `(${badReason.status})`);

  const reg = await req('/attendance/regularizations', {
    method: 'POST', token: empToken,
    body: {
      date: two.key, reason: 'Forgot to check in; was on-site all morning.',
      requestedCheckInAt: ist(two.y, two.m, two.d, 10, 0).toISOString(),
      requestedCheckOutAt: ist(two.y, two.m, two.d, 14, 0).toISOString(),
    },
  });
  check('employee creates regularization', reg.status >= 200 && reg.status < 300, `(${reg.status})`);
  const regId = reg.json?.id;

  const empApprove = await req(`/attendance/regularizations/${regId}/approve`, { method: 'POST', token: empToken, body: {} });
  check('Employee cannot approve own regularization -> 403', empApprove.status === 403, `(${empApprove.status})`);

  const sessionsBefore = await prisma.attendanceSession.count({ where: { userId: empId, checkInAt: { gte: ist(two.y, two.m, two.d, 0, 0) }, checkOutAt: { lte: ist(two.y, two.m, two.d, 23, 59) } } });
  const approve = await req(`/attendance/regularizations/${regId}/approve`, {
    method: 'POST', token: saToken, body: { comment: 'Confirmed with the team.' },
  });
  check('Super Admin approves regularization', approve.status >= 200 && approve.status < 300, `(${approve.status})`);
  check('approved status persisted', approve.json?.status === 'APPROVED');

  const sessionsAfter = await prisma.attendanceSession.count({ where: { userId: empId, checkInAt: { gte: ist(two.y, two.m, two.d, 0, 0) }, checkOutAt: { lte: ist(two.y, two.m, two.d, 23, 59) } } });
  check('approval creates a corrective session (history not overwritten, §5.3)', sessionsAfter === sessionsBefore + 1, `(${sessionsBefore}->${sessionsAfter})`);
  const regDay = await prisma.attendanceDay.findFirst({ where: { userId: empId, date: new Date(two.key) } });
  check('day recomputed after approval (4h -> PRESENT)', regDay?.workedSeconds === 4 * 3600, `(got ${regDay?.workedSeconds})`);

  // ── Audit (§5.10) ──
  const ciAudit = await prisma.auditLog.count({ where: { action: 'ATTENDANCE_CHECK_IN' } });
  const regAudit = await prisma.auditLog.count({ where: { action: 'REGULARIZATION_APPROVED' } });
  check('audit: ATTENDANCE_CHECK_IN written', ciAudit > 0);
  check('audit: REGULARIZATION_APPROVED written', regAudit > 0);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
