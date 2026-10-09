/**
 * Staff directory privacy (2026-10-09), end to end against the RUNNING API:
 * colleagues' email, phone and employee code are visible to Super Admin, HR and
 * Finance only. Everyone else sees names, roles and teams, plus their own record
 * in full, and can't search by email or phone.
 * Run: pnpm --filter @rademics/api verify:directory-privacy
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

async function get(path: string, token: string) {
  const res = await fetch(`${BASE}${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: (await res.json()) as any };
}

async function user(email: string, role: string): Promise<{ id: string; token: string }> {
  const password = 'DirVerify123!';
  const { id } = await prisma.user.upsert({
    where: { email },
    update: { status: 'ACTIVE', role: role as any, passwordHash: await argonHash(password), failedLoginCount: 0, lockedUntil: null },
    create: { email, name: `Dir Verify ${role}`, role: role as any, resourceType: 'INTERNAL', status: 'ACTIVE', phone: '9000000001', passwordHash: await argonHash(password) },
    select: { id: true },
  });
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { id, token: ((await res.json()) as any).accessToken as string };
}

async function main(): Promise<void> {
  const emp = await user('dir.verify.emp@test.local', 'EMPLOYEE');
  const tl = await user('dir.verify.tl@test.local', 'TEAM_LEAD');
  const hr = await user('dir.verify.hr@test.local', 'HR');
  const fin = await user('dir.verify.fin@test.local', 'FINANCE');
  const sa = await user('dir.verify.sa@test.local', 'SUPER_ADMIN');

  for (const [label, who] of [['Employee', emp], ['Team Lead', tl]] as const) {
    const { json } = await get('/employees?pageSize=100', who.token);
    const others = (json.items as any[]).filter((u) => u.id !== who.id);
    const me = (json.items as any[]).find((u) => u.id === who.id);
    check(`${label}: colleagues have no email/phone/code`, others.length > 0 && others.every((u) => u.email === '' && u.phone === null && u.employeeCode === null));
    check(`${label}: no manager emails`, others.every((u) => !u.reportingManager || u.reportingManager.email === ''));
    if (me) check(`${label}: own record in full`, Boolean(me.email));
    const s = await get('/employees?search=test.local', who.token);
    check(`${label}: can't search by email`, s.json.total === 0, `total=${s.json.total}`);
    const s2 = await get('/employees?search=9000000001', who.token);
    check(`${label}: can't search by phone`, s2.json.total === 0, `total=${s2.json.total}`);
    const one = await get(`/employees/${hr.id}`, who.token);
    check(`${label}: profile hides contacts`, one.json.email === '' && one.json.phone === null);
    const self = await get(`/employees/${who.id}`, who.token);
    check(`${label}: own profile in full`, Boolean(self.json.email));
  }

  for (const [label, who] of [['HR', hr], ['Finance', fin], ['Super Admin', sa]] as const) {
    const { json } = await get('/employees?pageSize=100', who.token);
    check(`${label}: sees colleagues' emails`, (json.items as any[]).some((u) => u.id !== who.id && u.email));
    const s = await get('/employees?search=dir.verify.emp', who.token);
    check(`${label}: can search by email`, s.json.total >= 1);
    const one = await get(`/employees/${emp.id}`, who.token);
    check(`${label}: profile shows phone`, one.json.phone === '9000000001');
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  if (failed) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
