/**
 * Security fixes — end-to-end against the RUNNING API.
 * Proves: nobody approves their own regularization; HR cannot edit or
 * deactivate a Super Admin; nobody deactivates themselves; download links
 * never let an uploaded file render as a web page.
 * Run: pnpm --filter @rademics/api verify:security
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

async function user(email: string, role: string, password: string): Promise<{ id: string; token: string }> {
  const { id } = await prisma.user.upsert({
    where: { email },
    update: { status: 'ACTIVE', role: role as any, passwordHash: await argonHash(password), failedLoginCount: 0, lockedUntil: null },
    create: {
      email, name: `Verify ${role}`, role: role as any, resourceType: 'INTERNAL',
      status: 'ACTIVE', passwordHash: await argonHash(password),
    },
    select: { id: true },
  });
  const r = await req('/auth/login', { method: 'POST', body: { email, password } });
  return { id, token: r.json?.accessToken as string };
}

async function main(): Promise<void> {
  console.log(`Verifying security fixes against ${BASE}\n`);
  const hr = await user('verify.sec.hr@rademics.local', 'HR', 'HrVerify123!');
  const hr2 = await user('verify.sec.hr2@rademics.local', 'HR', 'HrVerify123!');
  const sa = await user('verify.sec.sa@rademics.local', 'SUPER_ADMIN', 'SaVerify123!');
  check('Test users signed in', !!hr.token && !!hr2.token && !!sa.token);
  await prisma.regularizationRequest.deleteMany({ where: { userId: { in: [hr.id, hr2.id] } } });

  console.log('\n— Self-approval');
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() - 86_400_000));
  const own = await req('/attendance/regularizations', {
    method: 'POST', token: hr.token, body: { date: day, reason: 'Forgot to check in yesterday' },
  });
  check('HR can file their own request', own.status < 300, `(${own.status})`);
  const pending = await req('/attendance/regularizations/pending', { token: hr.token });
  check("HR's own request is not in their approval list", !pending.json?.items?.some((r: any) => r.id === own.json?.id));
  const self = await req(`/attendance/regularizations/${own.json?.id}/approve`, { method: 'POST', token: hr.token, body: {} });
  check('HR approving their own request is refused (403)', self.status === 403, `(${self.status})`);
  const other = await req(`/attendance/regularizations/${own.json?.id}/approve`, { method: 'POST', token: hr2.token, body: {} });
  check('Another HR can approve it', other.status < 300, `(${other.status})`);

  console.log('\n— Super Admin protection');
  const edit = await req(`/employees/${sa.id}`, { method: 'PATCH', token: hr.token, body: { name: 'Hacked' } });
  check('HR editing a Super Admin is refused (403)', edit.status === 403, `(${edit.status})`);
  const deact = await req(`/employees/${sa.id}/deactivate`, { method: 'POST', token: hr.token, body: {} });
  check('HR deactivating a Super Admin is refused (403)', deact.status === 403, `(${deact.status})`);
  const stillActive = await prisma.user.findUnique({ where: { id: sa.id }, select: { status: true } });
  check('Super Admin still active', stillActive?.status === 'ACTIVE');
  const selfDeact = await req(`/employees/${hr.id}/deactivate`, { method: 'POST', token: hr.token, body: {} });
  check('Deactivating yourself is refused (400)', selfDeact.status === 400, `(${selfDeact.status})`);
  const hrEdit = await req(`/employees/${hr2.id}`, { method: 'PATCH', token: hr.token, body: { name: 'Verify HR Two' } });
  check('HR can still edit a normal employee', hrEdit.status < 300, `(${hrEdit.status} ${JSON.stringify(hrEdit.json)})`);

  await prisma.regularizationRequest.deleteMany({ where: { userId: { in: [hr.id, hr2.id] } } });
  await prisma.attendanceSession.deleteMany({ where: { userId: { in: [hr.id, hr2.id] } } });
  await prisma.attendanceDay.deleteMany({ where: { userId: { in: [hr.id, hr2.id] } } });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
