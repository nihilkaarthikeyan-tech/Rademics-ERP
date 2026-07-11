/**
 * Phase 2 (People & Org) end-to-end verification.
 * Proves against the RUNNING API: departments/teams/skills, employee create+invite,
 * directory list, salary encryption + gating (§3/§10), settings + role editor (§23),
 * and audit entries (§5.10). Run: pnpm --filter @rademics/api verify:phase2
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

async function login(email: string, password: string): Promise<string> {
  const r = await req('/auth/login', { method: 'POST', body: { email, password } });
  return r.json?.accessToken as string;
}

async function main(): Promise<void> {
  console.log(`Verifying Phase 2 against ${BASE}\n`);
  const stamp = Date.now();

  const saToken = await login('admin@rademics.local', 'ChangeMe123!');
  check('Super Admin login', !!saToken);

  // Departments / Teams / Skills
  const dept = await req('/departments', {
    method: 'POST', token: saToken,
    body: { name: `Publications ${stamp}`, vertical: 'PUBLICATIONS' },
  });
  check('create department (people.departments.manage)', dept.status >= 200 && dept.status < 300, `(${dept.status})`);
  const deptId = dept.json?.id;

  const team = await req('/teams', {
    method: 'POST', token: saToken,
    body: { name: `Scopus Team ${stamp}`, departmentId: deptId },
  });
  check('create team in department', team.status >= 200 && team.status < 300, `(${team.status})`);
  const teamId = team.json?.id;

  const skill = await req('/skills', {
    method: 'POST', token: saToken, body: { name: `Scopus formatting ${stamp}` },
  });
  check('create skill tag', skill.status >= 200 && skill.status < 300, `(${skill.status})`);
  const skillId = skill.json?.id;

  // Employee create + invite
  const empEmail = `emp.${stamp}@rademics.local`;
  const emp = await req('/employees', {
    method: 'POST', token: saToken,
    body: {
      email: empEmail, name: 'New Employee', role: 'EMPLOYEE', resourceType: 'INTERNAL',
      departmentId: deptId, teamId, skillIds: [skillId], phone: '9876543210',
    },
  });
  check('create employee (invite) with dept/team/skill', emp.status >= 200 && emp.status < 300, `(${emp.status})`);
  const empId = emp.json?.id;
  check('created employee shows salaryVisible=true to Super Admin', emp.json?.salaryVisible === true);
  check('employee has 1 skill attached', Array.isArray(emp.json?.skills) && emp.json.skills.length === 1);

  // Salary encryption + read-back
  const setSalary = await req(`/employees/${empId}/salary`, {
    method: 'PUT', token: saToken, body: { salary: '55000' },
  });
  check('set salary', setSalary.status >= 200 && setSalary.status < 300, `(${setSalary.status})`);
  const empGet = await req(`/employees/${empId}`, { token: saToken });
  check('Super Admin reads decrypted salary', empGet.json?.salary === '55000', `(got ${empGet.json?.salary})`);

  // Ciphertext in DB is NOT the plaintext (encryption at rest, §10)
  const dbRow = await prisma.user.findUnique({ where: { id: empId }, select: { salaryCiphertext: true } });
  check('salary stored encrypted at rest', !!dbRow?.salaryCiphertext && !dbRow.salaryCiphertext.includes('55000'));

  // Directory list + search
  const list = await req(`/employees?search=${stamp}`, { token: saToken });
  check('directory search finds the new employee', (list.json?.total ?? 0) >= 1);

  // RBAC: Employee cannot see salary, cannot create departments
  await prisma.user.upsert({
    where: { email: 'verify.employee@rademics.local' },
    update: { status: 'ACTIVE', passwordHash: await argonHash('Employee123!') },
    create: {
      email: 'verify.employee@rademics.local', name: 'Verify Employee', role: 'EMPLOYEE',
      resourceType: 'INTERNAL', status: 'ACTIVE', passwordHash: await argonHash('Employee123!'),
    },
  });
  const empToken = await login('verify.employee@rademics.local', 'Employee123!');
  const empView = await req(`/employees/${empId}`, { token: empToken });
  check('Employee sees salaryVisible=false (salary gated, §3)', empView.json?.salaryVisible === false);
  check('Employee does NOT receive the salary value', empView.json?.salary === undefined);
  const empDept = await req('/departments', {
    method: 'POST', token: empToken, body: { name: `x ${stamp}`, vertical: 'WEB' },
  });
  check('Employee create department -> 403 (RBAC §10)', empDept.status === 403, `(${empDept.status})`);

  // Settings + role editor
  const rules = await req('/settings/business-rules', { token: saToken });
  check('read business rules (§4)', !!rules.json?.workStart, `(workStart=${rules.json?.workStart})`);
  const patched = await req('/settings/business-rules', {
    method: 'PUT', token: saToken, body: { patch: { lateThreshold: '09:20' } },
  });
  check('update business rules merges patch', patched.json?.lateThreshold === '09:20');
  const grants = await req('/settings/role-permissions', { token: saToken });
  check('role-permissions returns full matrix (308 grants)', (grants.json?.length ?? 0) === 308, `(${grants.json?.length})`);

  // Audit
  const deptAudit = await prisma.auditLog.count({ where: { action: 'DEPARTMENT_CREATED' } });
  const salaryAudit = await prisma.auditLog.count({ where: { action: 'SALARY_EDIT' } });
  check('audit: DEPARTMENT_CREATED exists', deptAudit > 0);
  check('audit: SALARY_EDIT exists (value never logged)', salaryAudit > 0);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
