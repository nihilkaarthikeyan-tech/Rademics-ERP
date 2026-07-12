/**
 * Phase 8 (Finance) end-to-end verification against the RUNNING API.
 * Proves the four §13 Done criteria: invoice lifecycle Draft→Paid with partial
 * payments; branded PDF renders + overdue auto-flags; P&L reconciles with entered
 * invoices + expenses (+ labour); payroll CSV matches attendance + leave for a test
 * month. Plus §24 validations, number-burning, cancel-and-reissue, payment reversal,
 * month lock/unlock + immutable revisions, and the scoped portal invoice read path.
 * Run: pnpm --filter @rademics/api verify:phase8
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

const num = (n: any) => Number(n ?? 0);

async function main(): Promise<void> {
  console.log(`Verifying Phase 8 against ${BASE}\n`);
  const stamp = Date.now();
  const saToken = await login('admin@rademics.local', 'ChangeMe123!');
  await ensureUser(`fin.${stamp}@rademics.local`, 'FINANCE', 'Password123!');
  const finToken = await login(`fin.${stamp}@rademics.local`, 'Password123!');
  const pmId = await ensureUser(`pm.${stamp}@rademics.local`, 'PM', 'Password123!');

  // Client org + user (portal read path).
  const org = await req('/client-orgs', { method: 'POST', token: saToken, body: { name: `FinCo ${stamp}` } });
  const clientId = await ensureUser(`client.${stamp}@client.local`, 'CLIENT', 'Client123!', { clientOrgId: org.json.id });
  const clientToken = await login(`client.${stamp}@client.local`, 'Client123!');

  // Project with a vertical for P&L grouping.
  const project = await prisma.project.create({ data: { name: `FinProj ${stamp}`, pmId, clientOrgId: org.json.id, vertical: 'WEB' } });

  // ── 1. Invoice validations (§24) ──
  const noLines = await req('/invoices', { method: 'POST', token: finToken, body: { issueDate: '2026-06-01', lines: [] } });
  check('invoice with no lines -> 400', noLines.status === 400, `(${noLines.status})`);
  const badGst = await req('/invoices', { method: 'POST', token: finToken, body: { issueDate: '2026-06-01', lines: [{ description: 'x', quantity: 1, rate: 10, gstPercent: 40 }] } });
  check('GST% > 28 -> 400', badGst.status === 400, `(${badGst.status})`);
  const badDue = await req('/invoices', { method: 'POST', token: finToken, body: { issueDate: '2026-06-10', dueDate: '2026-06-01', lines: [{ description: 'x', quantity: 1, rate: 10 }] } });
  check('due date before issue -> 400', badDue.status === 400, `(${badDue.status})`);

  // ── 2. Lifecycle: create → send → partial → paid (§5.8) ──
  const inv = await req('/invoices', { method: 'POST', token: finToken, body: {
    clientOrgId: org.json.id, projectId: project.id, issueDate: '2026-06-01', dueDate: '2026-06-16',
    lines: [{ description: 'Website build', quantity: 10, rate: 1000, gstPercent: 18 }],
  } });
  check('invoice created as DRAFT', inv.json?.status === 'DRAFT' && num(inv.json?.total) === 11800, `(${inv.json?.status}/${inv.json?.total})`);
  check('invoice number auto-assigned RAD-2026-####', /^RAD-2026-\d{4}$/.test(inv.json?.number ?? ''), `(${inv.json?.number})`);
  const invId = inv.json.id;

  const payBeforeSend = await req(`/invoices/${invId}/payments`, { method: 'POST', token: finToken, body: { amount: 100, mode: 'UPI' } });
  check('payment on a draft -> 400', payBeforeSend.status === 400, `(${payBeforeSend.status})`);

  const sent = await req(`/invoices/${invId}/send`, { method: 'POST', token: finToken, body: {} });
  check('invoice sent (DRAFT→SENT)', sent.json?.status === 'SENT', `(${sent.json?.status})`);

  const overpay = await req(`/invoices/${invId}/payments`, { method: 'POST', token: finToken, body: { amount: 99999, mode: 'Bank Transfer' } });
  check('overpayment blocked -> 400', overpay.status === 400, `(${overpay.status})`);

  const part = await req(`/invoices/${invId}/payments`, { method: 'POST', token: finToken, body: { amount: 5000, mode: 'UPI', reference: 'TXN1' } });
  check('partial payment → PARTIALLY_PAID', part.json?.status === 'PARTIALLY_PAID' && num(part.json?.balance) === 6800, `(${part.json?.status}/${part.json?.balance})`);

  const rest = await req(`/invoices/${invId}/payments`, { method: 'POST', token: finToken, body: { amount: 6800, mode: 'Bank Transfer', reference: 'TXN2' } });
  check('final payment → PAID (balance 0)', rest.json?.status === 'PAID' && num(rest.json?.balance) === 0, `(${rest.json?.status}/${rest.json?.balance})`);
  const pmPaidNotified = await prisma.notification.count({ where: { userId: pmId, type: 'INVOICE_PAID' } });
  check('PM notified invoice paid (§5.12)', pmPaidNotified > 0);

  // ── 3. Payment reversal = compensating entry (§25) ──
  const firstPay = await prisma.payment.findFirst({ where: { invoiceId: invId, reference: 'TXN2', isReversal: false }, select: { id: true } });
  const reversed = await req(`/invoices/payments/${firstPay!.id}/reverse`, { method: 'POST', token: finToken, body: { reason: 'bounced cheque' } });
  check('payment reversal reduces paid, reverts to PARTIALLY_PAID', reversed.json?.status === 'PARTIALLY_PAID' && num(reversed.json?.amountPaid) === 5000, `(${reversed.json?.status}/${reversed.json?.amountPaid})`);

  // ── 4. Number burning + cancel-and-reissue (§24) ──
  const invA = await req('/invoices', { method: 'POST', token: finToken, body: { issueDate: '2026-06-02', lines: [{ description: 'A', quantity: 1, rate: 100 }] } });
  const cancelled = await req(`/invoices/${invA.json.id}/cancel`, { method: 'POST', token: finToken, body: { reason: 'created by mistake' } });
  check('invoice cancelled', cancelled.json?.status === 'CANCELLED');
  const invB = await req('/invoices', { method: 'POST', token: finToken, body: { issueDate: '2026-06-02', lines: [{ description: 'B', quantity: 1, rate: 100 }] } });
  const seqA = Number(invA.json.number.split('-')[2]);
  const seqB = Number(invB.json.number.split('-')[2]);
  check('cancelled number is burned, never reused', seqB > seqA && invB.json.number !== invA.json.number, `(${invA.json.number} -> ${invB.json.number})`);

  const sendB = await req(`/invoices/${invB.json.id}/send`, { method: 'POST', token: finToken, body: {} });
  check('setup: invB sent', sendB.json?.status === 'SENT');
  const reissue = await req(`/invoices/${invB.json.id}/reissue`, { method: 'POST', token: finToken, body: { reason: 'wrong rate' } });
  check('cancel-and-reissue mints a new draft with a new number', reissue.json?.status === 'DRAFT' && reissue.json?.number !== invB.json.number && reissue.json?.reissuedFromId === invB.json.id, `(${reissue.json?.number})`);
  const oldB = await req(`/invoices/${invB.json.id}`, { token: finToken });
  check('reissued source is now CANCELLED', oldB.json?.status === 'CANCELLED');

  // ── 5. Branded PDF renders (§5.8) ──
  const pdfRes = await fetch(`${BASE}/invoices/${invId}/pdf`, { headers: { authorization: `Bearer ${finToken}` } });
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  check('invoice PDF renders (application/pdf, %PDF header)', pdfRes.headers.get('content-type')?.includes('pdf') === true && pdfBuf.subarray(0, 4).toString() === '%PDF' && pdfBuf.length > 800, `(${pdfRes.status}/${pdfBuf.length}b)`);

  // ── 6. Overdue auto-flag (§5.8) ──
  const od = await req('/invoices', { method: 'POST', token: finToken, body: { issueDate: '2026-01-01', dueDate: '2026-01-16', lines: [{ description: 'Old', quantity: 1, rate: 500 }] } });
  await req(`/invoices/${od.json.id}/send`, { method: 'POST', token: finToken, body: {} });
  const sweep = await req('/invoices/run-overdue-sweep', { method: 'POST', token: finToken, body: {} });
  check('overdue sweep flags past-due unpaid invoices', sweep.json?.flagged >= 1, `(${sweep.json?.flagged})`);
  const odAfter = await req(`/invoices/${od.json.id}`, { token: finToken });
  check('past-due invoice is now OVERDUE with daysOverdue', odAfter.json?.status === 'OVERDUE' && odAfter.json?.daysOverdue > 0, `(${odAfter.json?.status})`);

  // ── 7. Dues aging (§17.5) ──
  const dues = await req('/invoices/dues', { token: finToken });
  check('dues view returns per-client outstanding with aging buckets', Array.isArray(dues.json) && dues.json.some((d: any) => typeof d.total === 'number' && 'b0' in d));

  // ── 8. Expenses + P&L reconciliation (§5.8) ──
  const pnlBefore = await req('/finance/pnl', { token: finToken });
  const webBefore = (pnlBefore.json?.rows ?? []).find((r: any) => r.vertical === 'WEB') ?? { invoicedRevenue: 0, expensesTotal: 0, estimatedLaborCost: 0 };

  // A fresh SENT invoice (subtotal 10000), an expense (1200), and a labour-bearing task
  // (5h × EMPLOYEE rate 400 = 2000) — all against the WEB project.
  const pnlInv = await req('/invoices', { method: 'POST', token: finToken, body: { clientOrgId: org.json.id, projectId: project.id, issueDate: '2026-06-03', lines: [{ description: 'P&L build', quantity: 10, rate: 1000, gstPercent: 18 }] } });
  await req(`/invoices/${pnlInv.json.id}/send`, { method: 'POST', token: finToken, body: {} });
  const empId = await ensureUser(`emp.${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!');
  await prisma.task.create({ data: { projectId: project.id, title: 'Labor task', status: 'COMPLETED', actualHours: 5, assigneeId: empId } });
  const exp = await req('/finance/expenses', { method: 'POST', token: finToken, body: { projectId: project.id, category: 'Tool Subscription', amount: 1200, spentAt: '2026-06-05' } });
  check('expense logged against project', exp.status < 300, `(${exp.status})`);

  const pnlAfter = await req('/finance/pnl', { token: finToken });
  const webAfter = (pnlAfter.json?.rows ?? []).find((r: any) => r.vertical === 'WEB');
  // Invoice invId subtotal 10000 (ex-GST) contributes to WEB revenue.
  check('P&L revenue reconciles (Δ = invoice subtotal 10000)', Math.round((webAfter.invoicedRevenue - webBefore.invoicedRevenue) * 100) / 100 === 10000, `(Δ${webAfter.invoicedRevenue - webBefore.invoicedRevenue})`);
  check('P&L expenses reconcile (Δ = 1200)', Math.round((webAfter.expensesTotal - webBefore.expensesTotal) * 100) / 100 === 1200, `(Δ${webAfter.expensesTotal - webBefore.expensesTotal})`);
  check('P&L estimated labour reconciles (Δ = 5h × 400 = 2000)', Math.round((webAfter.estimatedLaborCost - webBefore.estimatedLaborCost) * 100) / 100 === 2000, `(Δ${webAfter.estimatedLaborCost - webBefore.estimatedLaborCost})`);

  // PM cannot log expense on someone else's project (SCOPED §3).
  const otherProj = await prisma.project.create({ data: { name: `Other ${stamp}`, pmId: (await ensureUser(`pm2.${stamp}@rademics.local`, 'PM', 'Password123!')) } });
  const pmToken = await login(`pm.${stamp}@rademics.local`, 'Password123!');
  const pmExpense = await req('/finance/expenses', { method: 'POST', token: pmToken, body: { projectId: otherProj.id, category: 'Travel', amount: 100, spentAt: '2026-06-05' } });
  check('PM cannot expense a project they do not manage -> 403', pmExpense.status === 403, `(${pmExpense.status})`);

  // ── 9. Payroll export matches attendance + leave (§5.8, §21) ──
  const payEmp = await ensureUser(`payemp.${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!', { employeeCode: `EMP-${stamp}` });
  const Y = 2026, M = 3;
  await prisma.attendanceDay.deleteMany({ where: { userId: payEmp } });
  await prisma.leaveRequest.deleteMany({ where: { userId: payEmp } });
  // Fresh export history for this test month (snapshots accumulate across runs).
  await prisma.payrollExport.deleteMany({ where: { year: Y, month: M } });
  await prisma.payrollMonth.deleteMany({ where: { year: Y, month: M } });
  const day = (d: string, data: any) => prisma.attendanceDay.create({ data: { userId: payEmp, date: new Date(`2026-03-${d}T00:00:00Z`), ...data } });
  await day('02', { status: 'PRESENT' });
  await day('03', { status: 'PRESENT' });
  await day('04', { status: 'HALF_DAY' });
  await day('05', { status: 'PRESENT', isLate: true, lateDeductionApplied: true });
  await day('06', { status: 'PRESENT', overtimeSeconds: 3600 });
  await prisma.leaveRequest.create({ data: { userId: payEmp, type: 'CASUAL', fromDate: new Date('2026-03-10T00:00:00Z'), toDate: new Date('2026-03-10T00:00:00Z'), reason: 'x', totalDays: 1, paidDays: 1, unpaidDays: 0, status: 'APPROVED', currentLevel: 'TEAM_LEAD' } });
  await prisma.leaveRequest.create({ data: { userId: payEmp, type: 'CASUAL', fromDate: new Date('2026-03-11T00:00:00Z'), toDate: new Date('2026-03-11T00:00:00Z'), reason: 'x', totalDays: 1, paidDays: 0, unpaidDays: 1, status: 'APPROVED', currentLevel: 'TEAM_LEAD' } });

  const exportBeforeLock = await req('/finance/payroll/export', { method: 'POST', token: finToken, body: { year: Y, month: M } });
  check('export before locking the month -> 409', exportBeforeLock.status === 409, `(${exportBeforeLock.status})`);
  const locked = await req('/finance/payroll/lock', { method: 'POST', token: finToken, body: { year: Y, month: M } });
  check('month locked', locked.json?.status === 'LOCKED');

  const exp1 = await req('/finance/payroll/export', { method: 'POST', token: finToken, body: { year: Y, month: M } });
  check('payroll export revision 1', exp1.json?.revision === 1, `(${exp1.json?.revision})`);
  const row = (exp1.json?.rows ?? []).find((r: any) => r.employeeCode === `EMP-${stamp}`);
  // present 4×1 + half 0.5 = 4.5; +1 paid casual − 1 (3-lates) = 4.5 payable; unpaid 1; OT 3600/(8×3600)=0.13.
  check('payroll row payable days = present+paidLeave−LOP (4.5)', row && num(row.payableDays) === 4.5, `(${row?.payableDays})`);
  check('payroll row paid casual leave = 1', row && num(row.paidLeaveByType?.CASUAL) === 1, `(${row?.paidLeaveByType?.CASUAL})`);
  check('payroll row unpaid leave = 1', row && num(row.unpaidLeaveDays) === 1, `(${row?.unpaidLeaveDays})`);
  check('payroll row 3-lates half-day deduction = 1', row && num(row.halfDayDeductions) === 1, `(${row?.halfDayDeductions})`);
  check('payroll row overtime days ≈ 0.13', row && num(row.overtimeDays) === 0.13, `(${row?.overtimeDays})`);
  check('CSV includes the employee code + header', typeof exp1.json?.csv === 'string' && exp1.json.csv.includes('Payable Days') && exp1.json.csv.includes(`EMP-${stamp}`));

  const exp2 = await req('/finance/payroll/export', { method: 'POST', token: finToken, body: { year: Y, month: M } });
  check('re-export is a new immutable revision', exp2.json?.revision === 2, `(${exp2.json?.revision})`);
  const exportsList = await req(`/finance/payroll/exports?year=${Y}&month=${M}`, { token: finToken });
  check('exports are retained as snapshots', Array.isArray(exportsList.json) && exportsList.json.length >= 2);

  const badUnlock = await req('/finance/payroll/unlock', { method: 'POST', token: finToken, body: { year: Y, month: M } });
  check('unlock without a reason -> 400', badUnlock.status === 400, `(${badUnlock.status})`);
  const unlock = await req('/finance/payroll/unlock', { method: 'POST', token: finToken, body: { year: Y, month: M, reason: 'correction to March attendance' } });
  check('unlock with reason succeeds (SA-approved, audited)', unlock.json?.status === 'OPEN', `(${unlock.json?.status})`);

  // ── 10. Portal invoice read path (§5.5, §17.7) ──
  const draftForOrg = await req('/invoices', { method: 'POST', token: finToken, body: { clientOrgId: org.json.id, projectId: project.id, issueDate: '2026-06-20', lines: [{ description: 'Draft', quantity: 1, rate: 10 }] } });
  const portalInv = await req('/portal/invoices', { token: clientToken });
  check('client sees own sent invoice in the portal', Array.isArray(portalInv.json) && portalInv.json.some((i: any) => i.id === invId), `(${portalInv.json?.length})`);
  check('portal never exposes draft invoices', Array.isArray(portalInv.json) && !portalInv.json.some((i: any) => i.id === draftForOrg.json.id));
  check('portal invoice omits internal fields (no createdById)', !JSON.stringify(portalInv.json).includes('createdById'));

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
