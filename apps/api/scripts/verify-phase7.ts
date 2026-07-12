/**
 * Phase 7 (Leave) end-to-end verification against the RUNNING API.
 * Proves the four §13 Done criteria: monthly accrual matches policy (and is
 * idempotent); the TL→PM→HR chain routes and 48h escalation bumps a level; overlap
 * warning appears; excess leave converts to Unpaid and is flagged for payroll. Plus
 * validations (§24), freelancer exclusion (§2), two-approver race (§25), cancel, and
 * the holiday-recompute refund (§25).
 * Run: pnpm --filter @rademics/api verify:phase7
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
    headers: { 'content-type': 'application/json', ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* empty */ }
  return { status: res.status, json };
}
const login = async (email: string, password: string) =>
  (await req('/auth/login', { method: 'POST', body: { email, password } })).json?.accessToken as string;

async function ensureUser(email: string, role: string, password: string, extra: Record<string, unknown> = {}) {
  const u = await prisma.user.upsert({
    where: { email },
    update: { status: 'ACTIVE', role: role as any, passwordHash: await argonHash(password), ...extra },
    create: { email, name: email.split('@')[0], role: role as any, resourceType: 'INTERNAL', status: 'ACTIVE', passwordHash: await argonHash(password), ...extra },
    select: { id: true },
  });
  return u.id;
}

/** The Monday `weeks` weeks ahead (UTC). Mon–Wed are all working days (Mon–Sat), so
 *  ranges anchored here never include a Sunday — day counts stay exact. */
function mondayAfter(weeks: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const daysUntilMonday = ((8 - d.getUTCDay()) % 7) || 7; // next Monday, at least 1 day out
  d.setUTCDate(d.getUTCDate() + daysUntilMonday + weeks * 7);
  return d;
}
function iso(base: Date, addDays = 0): string {
  const c = new Date(base);
  c.setUTCDate(c.getUTCDate() + addDays);
  return c.toISOString().slice(0, 10);
}

async function setBalance(userId: string, type: string, accrued: number, used = 0) {
  const year = new Date().getUTCFullYear();
  await prisma.leaveBalance.upsert({
    where: { userId_type_year: { userId, type: type as any, year } },
    update: { accruedDays: accrued, usedDays: used },
    create: { userId, type: type as any, year, accruedDays: accrued, usedDays: used },
  });
}

async function main(): Promise<void> {
  console.log(`Verifying Phase 7 against ${BASE}\n`);
  const stamp = Date.now();
  const saToken = await login('admin@rademics.local', 'ChangeMe123!');

  // Org: department + team led by a TL; an employee reports to that TL; a PM + HR exist.
  const tlId = await ensureUser(`tl.${stamp}@rademics.local`, 'TEAM_LEAD', 'Password123!');
  const pmId = await ensureUser(`pm.${stamp}@rademics.local`, 'PM', 'Password123!');
  await ensureUser(`hr.${stamp}@rademics.local`, 'HR', 'Password123!');
  // TL reports to the PM so the chain climbs deterministically TL→PM on escalation.
  await prisma.user.update({ where: { id: tlId }, data: { reportingManagerId: pmId } });
  const dept = await prisma.department.create({ data: { name: `Dept ${stamp}`, vertical: 'WEB' } });
  const team = await prisma.team.create({ data: { name: `Team ${stamp}`, departmentId: dept.id, teamLeadId: tlId } });
  const empId = await ensureUser(`emp.${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!', { teamId: team.id, reportingManagerId: tlId });
  const emp2Id = await ensureUser(`emp2.${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!', { teamId: team.id, reportingManagerId: tlId });
  await ensureUser(`free.${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!', { resourceType: 'FREELANCE' });

  const tlToken = await login(`tl.${stamp}@rademics.local`, 'Password123!');
  const empToken = await login(`emp.${stamp}@rademics.local`, 'Password123!');
  const emp2Token = await login(`emp2.${stamp}@rademics.local`, 'Password123!');
  const freeToken = await login(`free.${stamp}@rademics.local`, 'Password123!');

  // ── 1. Accrual matches policy + idempotent (§5.7) ──
  // Clean slate for the fresh users so accrual assertions are exact, and clear any
  // test holidays from an earlier same-day run (holidays are unique & persistent).
  await prisma.leaveBalance.deleteMany({ where: { userId: { in: [empId, emp2Id] } } });
  await prisma.leaveLedger.deleteMany({ where: { userId: { in: [empId, emp2Id] } } });
  await prisma.holiday.deleteMany({ where: { date: { gte: mondayAfter(1) } } });
  const accr = await req('/leave/admin/run-accrual', { method: 'POST', token: saToken, body: {} });
  check('accrual job runs (leave.policy.configure)', accr.status < 300, `(${accr.status})`);
  const bal = await req('/leave/balances', { token: empToken });
  const casual = bal.json?.find((b: any) => b.type === 'CASUAL');
  const earned = bal.json?.find((b: any) => b.type === 'EARNED');
  const sick = bal.json?.find((b: any) => b.type === 'SICK');
  check('casual accrues 1/month per policy', casual?.accruedDays === 1, `(${casual?.accruedDays})`);
  check('earned accrues 1.25/month per policy', earned?.accruedDays === 1.25, `(${earned?.accruedDays})`);
  check('sick has no accrual per policy', sick?.accruedDays === 0, `(${sick?.accruedDays})`);
  check('balance exposes projected accrual', typeof casual?.projectedYearEndAvailable === 'number');
  await req('/leave/admin/run-accrual', { method: 'POST', token: saToken, body: {} });
  const bal2 = await req('/leave/balances', { token: empToken });
  check('accrual is idempotent (no double-credit)', bal2.json?.find((b: any) => b.type === 'CASUAL')?.accruedDays === 1);

  const w1 = mondayAfter(1);

  // ── 2. Validations (§24) ──
  const half = await req('/leave', { method: 'POST', token: empToken, body: { type: 'CASUAL', fromDate: iso(w1), toDate: iso(w1, 2), half: 'FIRST_HALF', reason: 'appointment' } });
  check('half-day across multiple days -> 400', half.status === 400, `(${half.status})`);
  const rev = await req('/leave', { method: 'POST', token: empToken, body: { type: 'CASUAL', fromDate: iso(w1, 2), toDate: iso(w1), reason: 'reversed dates' } });
  check('end-before-start -> 400', rev.status === 400, `(${rev.status})`);
  const free = await req('/leave', { method: 'POST', token: freeToken, body: { type: 'CASUAL', fromDate: iso(w1), toDate: iso(w1), reason: 'freelancer' } });
  check('freelancer cannot request leave -> 403 (§2)', free.status === 403, `(${free.status})`);

  // ── 3. Chain routes to the TL, approval deducts balance (§5.7) ──
  const single = await req('/leave', { method: 'POST', token: empToken, body: { type: 'CASUAL', fromDate: iso(w1), toDate: iso(w1), reason: 'one day off' } });
  check('leave request created, routed to TEAM_LEAD', single.json?.currentLevel === 'TEAM_LEAD' && single.json?.currentApproverId === tlId, `(${single.json?.currentLevel})`);
  const selfOverlap = await req('/leave', { method: 'POST', token: empToken, body: { type: 'CASUAL', fromDate: iso(w1), toDate: iso(w1), reason: 'dup day' } });
  check('self-overlapping request -> 400 (§24)', selfOverlap.status === 400, `(${selfOverlap.status})`);
  const tlPending = await req('/leave/pending', { token: tlToken });
  check('request appears in TL approval queue', Array.isArray(tlPending.json) && tlPending.json.some((r: any) => r.id === single.json.id));
  const empApproveOwn = await req(`/leave/${single.json.id}/approve`, { method: 'POST', token: empToken, body: {} });
  check('non-approver cannot approve -> 403', empApproveOwn.status === 403, `(${empApproveOwn.status})`);
  const approved = await req(`/leave/${single.json.id}/approve`, { method: 'POST', token: tlToken, body: {} });
  check('TL approves (→APPROVED)', approved.json?.status === 'APPROVED', `(${approved.json?.status ?? approved.status})`);
  const empNotified = await prisma.notification.count({ where: { userId: empId, type: 'LEAVE_APPROVED' } });
  check('employee notified of approval (§5.12)', empNotified > 0);
  const balAfter = await req('/leave/balances', { token: empToken });
  check('approval deducts balance (casual used = 1)', balAfter.json?.find((b: any) => b.type === 'CASUAL')?.usedDays === 1);

  // Two-approver race (§25): re-approving the same request loses.
  const race = await req(`/leave/${single.json.id}/approve`, { method: 'POST', token: tlToken, body: {} });
  check('already-actioned request -> 409 (first write wins, §25)', race.status === 409, `(${race.status})`);

  // ── 4. Excess beyond balance auto-converts to Unpaid, flagged for payroll (§5.7) ──
  // Casual balance now 1 accrued / 1 used → 0 available. Request 3 working days.
  const w2 = mondayAfter(2);
  const excess = await req('/leave', { method: 'POST', token: empToken, body: { type: 'CASUAL', fromDate: iso(w2), toDate: iso(w2, 2), reason: 'three days, no balance' } });
  const excApproved = await req(`/leave/${excess.json.id}/approve`, { method: 'POST', token: tlToken, body: {} });
  check('excess leave auto-converts to Unpaid (§5.7)', Number(excApproved.json?.unpaidDays) === 3 && Number(excApproved.json?.paidDays) === 0, `(paid ${excApproved.json?.paidDays}, unpaid ${excApproved.json?.unpaidDays})`);
  const payrollFlagged = await prisma.leaveRequest.findFirst({ where: { id: excess.json.id, unpaidDays: { gt: 0 } }, select: { id: true } });
  check('unpaid days flagged on the request for payroll export (§8)', Boolean(payrollFlagged));

  // ── 5. 48h escalation bumps a level, notifies both parties (§5.7) ──
  const w3 = mondayAfter(3);
  const esc = await req('/leave', { method: 'POST', token: emp2Token, body: { type: 'SICK', fromDate: iso(w3), toDate: iso(w3), reason: 'unwell' } });
  await prisma.leaveRequest.update({ where: { id: esc.json.id }, data: { escalationDueAt: new Date(Date.now() - 1000) } });
  const sweep = await req('/leave/admin/run-escalation', { method: 'POST', token: saToken });
  check('escalation sweep runs', sweep.status < 300, `(${sweep.status})`);
  const escalated = await prisma.leaveRequest.findUnique({ where: { id: esc.json.id } });
  check('unactioned 48h escalates one level (TEAM_LEAD→PM)', escalated?.currentLevel === 'PM' && escalated?.escalatedCount === 1, `(${escalated?.currentLevel}/${escalated?.escalatedCount})`);
  check('escalated request re-routes to the PM', escalated?.currentApproverId === pmId, `(${escalated?.currentApproverId})`);
  const bothNotified = await prisma.notification.count({ where: { type: 'LEAVE_ESCALATED', userId: { in: [emp2Id, pmId] } } });
  check('both parties notified on escalation (§5.7)', bothNotified >= 2, `(${bothNotified})`);

  // ── 6. Overlap warning within the team (§5.7) ──
  await setBalance(empId, 'EARNED', 10, 0);
  await setBalance(emp2Id, 'EARNED', 10, 0);
  const w4 = mondayAfter(4);
  const oFrom = iso(w4), oTo = iso(w4, 2);
  const o1 = await req('/leave', { method: 'POST', token: empToken, body: { type: 'EARNED', fromDate: oFrom, toDate: oTo, reason: 'team trip' } });
  const o2 = await req('/leave', { method: 'POST', token: emp2Token, body: { type: 'EARNED', fromDate: oFrom, toDate: oTo, reason: 'team trip too' } });
  const pend = await req('/leave/pending', { token: tlToken });
  const o2row = Array.isArray(pend.json) ? pend.json.find((r: any) => r.id === o2.json.id) : null;
  check('approver sees overlap warning for same-team leave (§5.7)', o2row?.overlap?.overlaps === true && o2row.overlap.names.length > 0, `(${JSON.stringify(o2row?.overlap)})`);
  const cal = await req(`/leave/calendar?from=${oFrom}&to=${oTo}`, { token: tlToken });
  check('team calendar flags overlaps', Array.isArray(cal.json?.items) && cal.json.items.some((it: any) => it.id === o1.json.id && it.overlaps === true));

  // ── 7. Cancel own pending request (§5.7) ──
  const cancelled = await req(`/leave/${o1.json.id}/cancel`, { method: 'POST', token: empToken, body: {} });
  check('employee cancels own pending request', cancelled.json?.status === 'CANCELLED', `(${cancelled.json?.status ?? cancelled.status})`);

  // ── 8. Holiday recompute refunds an approved leave day (§25) ──
  await setBalance(emp2Id, 'CASUAL', 10, 0);
  const w5 = mondayAfter(5);
  const hFrom = iso(w5), hMid = iso(w5, 1), hTo = iso(w5, 2);
  const hReq = await req('/leave', { method: 'POST', token: emp2Token, body: { type: 'CASUAL', fromDate: hFrom, toDate: hTo, reason: 'span with holiday' } });
  const hApproved = await req(`/leave/${hReq.json.id}/approve`, { method: 'POST', token: tlToken, body: {} });
  const paidBefore = Number(hApproved.json?.paidDays);
  const holiday = await req('/leave/holidays', { method: 'POST', token: saToken, body: { date: hMid, name: `Festival ${stamp}` } });
  check('adding a holiday refunds overlapping approved leave (§25)', holiday.json?.refundedRequests >= 1, `(${holiday.json?.refundedRequests})`);
  const hAfter = await prisma.leaveRequest.findUnique({ where: { id: hReq.json.id } });
  check('paid days reduced by the new holiday', Number(hAfter?.paidDays) === paidBefore - 1, `(${paidBefore} -> ${hAfter?.paidDays})`);
  const refundNotified = await prisma.notification.count({ where: { userId: emp2Id, type: 'LEAVE_REFUNDED' } });
  check('employee notified of the refund', refundNotified > 0);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
