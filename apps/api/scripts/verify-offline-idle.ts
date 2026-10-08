/**
 * Offline activity + power-cut idle removal — end-to-end against the RUNNING API.
 * Proves: activity saved offline is replayed so working through an outage isn't
 * idle; a real silence is still idle; bogus moments are ignored; a POWER_CUT
 * approval removes exactly the idle inside its window, and only once.
 * Run: pnpm --filter @rademics/api verify:offline-idle  (inside the 09:00–18:00 IST shift)
 */
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';

const prisma = new PrismaClient();
const BASE = `http://127.0.0.1:${process.env.API_PORT ?? 4000}/api`;
const MIN = 60_000;

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${detail}`); }
}

// Replay is only honoured from the desktop app — act like it unless told not to.
const DESKTOP_KEY = process.env.DESKTOP_APP_KEY ?? '';

async function req(path: string, opts: { method?: string; token?: string; body?: unknown; web?: boolean } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      ...(DESKTOP_KEY && !opts.web ? { 'x-rademics-desktop': DESKTOP_KEY } : {}),
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

const minutesBetween = (from: number, to: number) => {
  const out: string[] = [];
  for (let t = from; t <= to; t += MIN) out.push(new Date(t).toISOString());
  return out;
};

async function main(): Promise<void> {
  console.log(`Verifying offline idle + power cut against ${BASE}\n`);
  // HR approves regularizations company-wide (ALLOW grant).
  await prisma.user.upsert({
    where: { email: 'verify.hr@rademics.local' },
    update: { status: 'ACTIVE', role: 'HR', passwordHash: await argonHash('HrVerify123!') },
    create: {
      email: 'verify.hr@rademics.local', name: 'Verify HR', role: 'HR', resourceType: 'INTERNAL',
      status: 'ACTIVE', passwordHash: await argonHash('HrVerify123!'),
    },
  });
  const saToken = await login('verify.hr@rademics.local', 'HrVerify123!');
  check('HR login', !!saToken);

  const email = 'verify.offline@rademics.local';
  const { id: empId } = await prisma.user.upsert({
    where: { email },
    update: { status: 'ACTIVE', passwordHash: await argonHash('Employee123!') },
    create: {
      email, name: 'Verify Offline', role: 'EMPLOYEE', resourceType: 'INTERNAL',
      status: 'ACTIVE', passwordHash: await argonHash('Employee123!'),
    },
    select: { id: true },
  });
  await prisma.regularizationRequest.deleteMany({ where: { userId: empId } });
  await prisma.attendanceSession.deleteMany({ where: { userId: empId } });
  const token = await login(email, 'Employee123!');
  check('Employee login', !!token);

  if (!DESKTOP_KEY) throw new Error('Set DESKTOP_APP_KEY (same value as the running API) to run this check');
  const ci = await req('/attendance/check-in', { method: 'POST', token, body: { source: 'DESKTOP' } });
  check('Check-in', ci.status < 300, `(${ci.status})`);
  const sessionId = ci.json?.id as string;
  const rewind = (ms: number) =>
    prisma.attendanceSession.update({
      where: { id: sessionId },
      data: { checkInAt: new Date(Date.now() - 2 * 3600 * 1000), lastHeartbeatAt: new Date(Date.now() - ms) },
    });
  const idle = async () => (await prisma.attendanceSession.findUniqueOrThrow({ where: { id: sessionId } })).idleSeconds;

  console.log('\n— Worked through a 60-min internet drop');
  await rewind(60 * MIN);
  let now = Date.now();
  let hb = await req('/attendance/heartbeat', {
    method: 'POST', token, body: { offlineAt: minutesBetween(now - 59 * MIN, now - MIN) },
  });
  check('Heartbeat with saved activity accepted', hb.status < 300, `(${hb.status} ${JSON.stringify(hb.json)})`);
  check('All 59 saved moments replayed', hb.json?.replayed === 59, `(${hb.json?.replayed})`);
  check('No idle charged', (await idle()) === 0, `(${await idle()})`);

  console.log('\n— Same trick from the website (no desktop key) is ignored');
  await rewind(30 * MIN);
  now = Date.now();
  const beforeWeb = await idle();
  hb = await req('/attendance/heartbeat', {
    method: 'POST', token, web: true, body: { offlineAt: minutesBetween(now - 29 * MIN, now - MIN) },
  });
  check('Website replay not honoured', hb.json?.replayed === 0, `(${hb.json?.replayed})`);
  check('30 min charged as idle', Math.abs((await idle()) - beforeWeb - 1800) <= 2, `(${(await idle()) - beforeWeb})`);
  const audited = await prisma.auditLog.count({ where: { action: 'ATTENDANCE_OFFLINE_REPLAY', entityId: sessionId } });
  check('Desktop replay was written to the audit log', audited === 1, `(${audited})`);
  await prisma.attendanceIdleGap.deleteMany({ where: { sessionId } });
  await prisma.attendanceSession.update({ where: { id: sessionId }, data: { idleSeconds: 0 } });

  console.log('\n— Really away for 60 min (nothing saved)');
  await rewind(60 * MIN);
  const awayEnd = Date.now();
  hb = await req('/attendance/heartbeat', { method: 'POST', token, body: {} });
  const afterAway = await idle();
  check('60 min charged as idle', Math.abs(afterAway - 3600) <= 2, `(${afterAway})`);
  const gaps1 = await prisma.attendanceIdleGap.findMany({ where: { sessionId } });
  check('One idle stretch recorded', gaps1.length === 1 && Math.abs(gaps1[0]!.seconds - 3600) <= 2, JSON.stringify(gaps1));

  console.log('\n— Worked 20 min offline, then away 40 min');
  await rewind(60 * MIN);
  now = Date.now();
  hb = await req('/attendance/heartbeat', {
    method: 'POST', token, body: { offlineAt: minutesBetween(now - 59 * MIN, now - 40 * MIN) },
  });
  const mixed = (await idle()) - afterAway;
  check('Only the 40-min silence charged', Math.abs(mixed - 2400) <= 2, `(${mixed})`);

  console.log('\n— Bogus moments are ignored');
  const before = await idle();
  hb = await req('/attendance/heartbeat', {
    method: 'POST', token,
    body: { offlineAt: [new Date(Date.now() + 3600 * 1000).toISOString(), new Date(Date.now() - 5 * 3600 * 1000).toISOString()] },
  });
  check('Future / pre-session moments not replayed', hb.json?.replayed === 0, `(${hb.json?.replayed})`);
  check('Idle unchanged', (await idle()) === before);
  const tooMany = await req('/attendance/heartbeat', {
    method: 'POST', token, body: { offlineAt: Array.from({ length: 1501 }, () => new Date().toISOString()) },
  });
  check('More than 1500 moments rejected (400)', tooMany.status === 400, `(${tooMany.status})`);
  const junk = await req('/attendance/heartbeat', { method: 'POST', token, body: { offlineAt: ['yesterday'] } });
  check('Non-date moment rejected (400)', junk.status === 400, `(${junk.status})`);

  console.log('\n— Power cut request');
  // Rewinding the clock above stacked stretches that overlap in time — real
  // history can't (lastHeartbeatAt only moves forward). Keep just the 60-min
  // away stretch so the window below has one honest stretch to cut from.
  const awayGap = gaps1[0]!;
  await prisma.attendanceIdleGap.deleteMany({ where: { sessionId, id: { not: awayGap.id } } });
  await prisma.attendanceSession.update({ where: { id: sessionId }, data: { idleSeconds: awayGap.seconds } });
  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
  const bad = await req('/attendance/regularizations', {
    method: 'POST', token, body: { kind: 'POWER_CUT', date: todayKey, reason: 'Power cut in my area today' },
  });
  check('Power cut without times rejected', bad.status === 400, `(${bad.status})`);
  const future = await req('/attendance/regularizations', {
    method: 'POST', token,
    body: {
      kind: 'POWER_CUT', date: todayKey, reason: 'Power cut in my area today',
      requestedCheckInAt: new Date(Date.now() - MIN).toISOString(),
      requestedCheckOutAt: new Date(Date.now() + 30 * MIN).toISOString(),
    },
  });
  check('Power cut ending in the future rejected', future.status === 400, `(${future.status})`);

  // Claim the middle 30 min of the 60-min away stretch.
  const window = {
    requestedCheckInAt: new Date(awayEnd - 45 * MIN).toISOString(),
    requestedCheckOutAt: new Date(awayEnd - 15 * MIN).toISOString(),
  };
  const idleBefore = await idle();
  const pc = await req('/attendance/regularizations', {
    method: 'POST', token, body: { kind: 'POWER_CUT', date: todayKey, reason: 'Power cut in my area, PC off', ...window },
  });
  check('Power cut request created', pc.status < 300 && pc.json?.kind === 'POWER_CUT', `(${pc.status} ${JSON.stringify(pc.json)})`);
  const pending = await req('/attendance/regularizations/pending', { token: saToken });
  check('HR sees it as a power cut', pending.json?.items?.some((r: any) => r.id === pc.json?.id && r.kind === 'POWER_CUT'));
  const ok = await req(`/attendance/regularizations/${pc.json?.id}/approve`, { method: 'POST', token: saToken, body: {} });
  check('Approved', ok.status < 300, `(${ok.status} ${JSON.stringify(ok.json)})`);
  check('Exactly 30 min credited', Math.abs((ok.json?.idleCreditedSeconds ?? 0) - 1800) <= 2, `(${ok.json?.idleCreditedSeconds})`);
  check('Session idle down by 30 min', Math.abs(idleBefore - (await idle()) - 1800) <= 2, `(${idleBefore} → ${await idle()})`);
  const day = await prisma.attendanceDay.findFirst({ where: { userId: empId, date: new Date(todayKey) } });
  check('Day figures recomputed', day !== null && day.idleSeconds === (await idle()), `(${day?.idleSeconds})`);

  const again = await req('/attendance/regularizations', {
    method: 'POST', token, body: { kind: 'POWER_CUT', date: todayKey, reason: 'Same power cut, asking twice', ...window },
  });
  const ok2 = await req(`/attendance/regularizations/${again.json?.id}/approve`, { method: 'POST', token: saToken, body: {} });
  check('Same window again credits nothing', ok2.json?.idleCreditedSeconds === 0, `(${ok2.json?.idleCreditedSeconds})`);

  const corr = await req('/attendance/regularizations', {
    method: 'POST', token, body: { date: todayKey, reason: 'Plain correction still works' },
  });
  check('Ordinary correction still defaults to CORRECTION', corr.json?.kind === 'CORRECTION', `(${corr.status})`);

  const co = await req('/attendance/check-out', { method: 'POST', token, body: {} });
  check('Check-out', co.status < 300, `(${co.status})`);

  await prisma.regularizationRequest.deleteMany({ where: { userId: empId } });
  await prisma.attendanceSession.deleteMany({ where: { userId: empId } });
  await prisma.attendanceDay.deleteMany({ where: { userId: empId } });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
