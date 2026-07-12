/**
 * Phase 9 (Skills, Reports & AI) end-to-end verification against the RUNNING API.
 * Proves the §13 Done criteria: all four AI features return useful output on seed data
 * (with graceful rule-based fallback when no provider key is set); an out-of-scope
 * question is refused; the per-user daily rate limit is enforced; and each report
 * matches manually-computed values with working CSV/PDF exports. Plus the §5.9 capacity
 * view and the AI permission boundary (clients denied).
 * Run: pnpm --filter @rademics/api verify:phase9
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
  console.log(`Verifying Phase 9 against ${BASE}\n`);
  const stamp = Date.now();
  const saToken = await login('admin@rademics.local', 'ChangeMe123!');

  // Org: department + team led by a TL; two members.
  const tlId = await ensureUser(`tl.${stamp}@rademics.local`, 'TEAM_LEAD', 'Password123!');
  const dept = await prisma.department.create({ data: { name: `Dept ${stamp}`, vertical: 'WEB' } });
  const team = await prisma.team.create({ data: { name: `Team ${stamp}`, departmentId: dept.id, teamLeadId: tlId } });
  const emp1 = await ensureUser(`emp1.${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!', { teamId: team.id, reportingManagerId: tlId, employeeCode: `E1-${stamp}` });
  const emp2 = await ensureUser(`emp2.${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!', { teamId: team.id, reportingManagerId: tlId, employeeCode: `E2-${stamp}` });
  await prisma.user.update({ where: { id: tlId }, data: { teamId: team.id } });
  const emp1Token = await login(`emp1.${stamp}@rademics.local`, 'Password123!');

  // Skills + a skilled candidate for assignment suggestion.
  const skill = await prisma.skillTag.upsert({ where: { name: `React-${stamp}` }, update: {}, create: { name: `React-${stamp}` } });
  await prisma.userSkill.create({ data: { userId: emp1, skillId: skill.id } });

  // Project P1 (emp1's) with tasks; P2 (out of emp1 scope).
  const p1 = await prisma.project.create({ data: { name: `Alpha ${stamp}`, pmId: tlId, vertical: 'WEB' } });
  const p2 = await prisma.project.create({ data: { name: `ZetaSecret ${stamp}`, vertical: 'WEB' } });
  const overdueTask = await prisma.task.create({ data: { projectId: p1.id, title: 'Overdue thing', status: 'IN_PROGRESS', assigneeId: emp1, deadline: new Date(Date.now() - 3 * 86400000), estimatedHours: 10 } });
  await prisma.task.create({ data: { projectId: p1.id, title: 'Open thing', status: 'ASSIGNED', assigneeId: emp1, estimatedHours: 6 } });
  const doneTask = await prisma.task.create({ data: { projectId: p1.id, title: 'Done thing', status: 'COMPLETED', assigneeId: emp1, estimatedHours: 4, actualHours: 5, deadline: new Date(Date.now() + 86400000) } });
  // Immutable history: velocity + productivity stage times + daily summary source.
  const now = new Date();
  await prisma.taskStatusHistory.createMany({ data: [
    { taskId: doneTask.id, toStatus: 'IN_PROGRESS', action: 'START_WORK', actorId: emp1, createdAt: new Date(now.getTime() - 5 * 3600000) },
    { taskId: doneTask.id, toStatus: 'SUBMITTED_FOR_REVIEW', action: 'SUBMIT', actorId: emp1, createdAt: new Date(now.getTime() - 3 * 3600000) },
    { taskId: doneTask.id, toStatus: 'COMPLETED', action: 'APPROVE_REVIEW', actorId: tlId, createdAt: now },
    { taskId: overdueTask.id, toStatus: 'IN_PROGRESS', action: 'SEND_BACK', actorId: tlId, createdAt: new Date(now.getTime() - 2 * 3600000) },
  ] });

  // ── 1. Capacity view (§5.9) ──
  const cap = await req('/reports/capacity', { token: saToken });
  const capEmp1 = Array.isArray(cap.json) ? cap.json.find((c: any) => c.userId === emp1) : null;
  check('capacity view returns load + traffic-light', capEmp1 && capEmp1.loadHours === 16 && ['GREEN', 'AMBER', 'RED'].includes(capEmp1.availability), `(${JSON.stringify(capEmp1 && { load: capEmp1.loadHours, a: capEmp1.availability })})`);
  check('capacity surfaces skills + weekly capacity', capEmp1 && capEmp1.weeklyCapacity === 40 && capEmp1.skills.includes(`React-${stamp}`));

  // ── 2. AI: daily summary, generated once per team per day (§7) ──
  await prisma.attendanceDay.deleteMany({ where: { userId: emp1, date: new Date(now.toISOString().slice(0, 10)) } });
  await prisma.attendanceDay.create({ data: { userId: emp1, date: new Date(now.toISOString().slice(0, 10)), status: 'PRESENT', isLate: true } });
  await prisma.aiDailySummary.deleteMany({ where: { teamId: team.id } });
  const sum1 = await req('/ai/daily-summary', { method: 'POST', token: saToken, body: { teamId: team.id } });
  check('daily summary returns labeled output', typeof sum1.json?.text === 'string' && sum1.json.text.length > 0 && 'aiGenerated' in sum1.json && sum1.json.disclaimer?.includes('AI-generated'), `(${sum1.status})`);
  check('daily summary reflects seed facts (completed/late)', /Done thing|late|completed/i.test(sum1.json?.text ?? ''), `(${sum1.json?.text?.slice(0, 80)})`);
  const sum2 = await req('/ai/daily-summary', { method: 'POST', token: saToken, body: { teamId: team.id } });
  check('daily summary is cached (generated once per team/day)', sum2.json?.cached === true);

  // ── 3. AI: completion forecast — baseline + narrative (§7) ──
  const fc = await req(`/ai/completion-forecast/${p1.id}`, { token: saToken });
  check('forecast returns rule-based baseline + risk', fc.json?.baseline && typeof fc.json.baseline.openTasks === 'number' && ['LOW', 'MEDIUM', 'HIGH'].includes(fc.json.baseline.risk), `(${JSON.stringify(fc.json?.baseline && { open: fc.json.baseline.openTasks, risk: fc.json.baseline.risk })})`);
  check('forecast is labeled AI-generated', typeof fc.json?.text === 'string' && fc.json.disclaimer?.includes('AI-generated'));

  // ── 4. AI: assignment suggestion — skill + load ranked (§7) ──
  const sug = await req('/ai/assignment-suggestion', { method: 'POST', token: saToken, body: { title: 'Build UI', skillIds: [skill.id] } });
  const skilled = (sug.json?.suggestions ?? []).find((s: any) => s.userId === emp1);
  check('assignment suggestion ranks by skill match + load', skilled && skilled.skillMatches === 1 && ['GREEN', 'AMBER', 'RED'].includes(skilled.availability), `(${JSON.stringify(skilled)})`);
  check('assignment suggestion is a suggestion (human decides)', typeof sug.json?.note === 'string' && sug.json.note.toLowerCase().includes('suggestion'));

  // ── 5. AI: scoped chat — cited answer + out-of-scope refusal (§7) ──
  const chatOverdue = await req('/ai/chat', { method: 'POST', token: emp1Token, body: { question: 'what is overdue?' } });
  check('chat answers in-scope with citations', /overdue/i.test(chatOverdue.json?.text ?? '') && Array.isArray(chatOverdue.json?.citations) && chatOverdue.json.citations.length > 0, `(${chatOverdue.json?.text?.slice(0, 80)})`);
  const chatOut = await req('/ai/chat', { method: 'POST', token: emp1Token, body: { question: `what is overdue on ZetaSecret ${stamp}?` } });
  check('out-of-scope project question is refused (§7 no leakage)', /outside your access|out of scope|can'?t answer/i.test(chatOut.json?.text ?? ''), `(${chatOut.json?.text?.slice(0, 90)})`);

  // ── 6. Rate limit enforced (§7, §10) ──
  const rateEmp = await ensureUser(`rate.${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!');
  const rateToken = await login(`rate.${stamp}@rademics.local`, 'Password123!');
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  await prisma.aiUsage.upsert({ where: { userId_date: { userId: rateEmp, date: today } }, update: { count: 9999 }, create: { userId: rateEmp, date: today, count: 9999 } });
  const limited = await req('/ai/chat', { method: 'POST', token: rateToken, body: { question: 'anything at all' } });
  check('daily AI rate limit enforced -> 429', limited.status === 429, `(${limited.status})`);

  // ── 7. AI permission boundary: clients denied (§7 respects matrix) ──
  const clientId = await ensureUser(`client.${stamp}@client.local`, 'CLIENT', 'Client123!');
  const clientToken = await login(`client.${stamp}@client.local`, 'Client123!');
  const clientChat = await req('/ai/chat', { method: 'POST', token: clientToken, body: { question: 'show me everything' } });
  check('client cannot use the AI assistant -> 403', clientChat.status === 403, `(${clientChat.status})`);

  // ── 8. Reports match manually-computed values (§5.11, §21) ──
  const reportEmp = await ensureUser(`rep.${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!', { teamId: team.id, employeeCode: `R-${stamp}` });
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const d = (day: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  await prisma.attendanceDay.deleteMany({ where: { userId: reportEmp } });
  await prisma.attendanceDay.createMany({ data: [
    { userId: reportEmp, date: d(2), status: 'PRESENT', workedSeconds: 8 * 3600 },
    { userId: reportEmp, date: d(3), status: 'PRESENT', isLate: true, workedSeconds: 7 * 3600, idleSeconds: 3600 },
    { userId: reportEmp, date: d(4), status: 'HALF_DAY', workedSeconds: 3 * 3600 },
    { userId: reportEmp, date: d(5), status: 'ABSENT' },
  ] });
  const from = monthStart.toISOString().slice(0, 10);
  const to = now.toISOString(); // full timestamp so today's updatedAt rows are included
  const att = await req(`/reports/attendance?from=${from}&to=${to}`, { token: saToken });
  const attRow = (att.json?.rows ?? []).find((r: any) => r.employee.includes(`rep.${stamp}`.split('@')[0]));
  check('attendance report counts match seed (present 2, half 1, absent 1, late 1)', attRow && attRow.present === 2 && attRow.halfDays === 1 && attRow.absent === 1 && attRow.lateCount === 1, `(${JSON.stringify(attRow && { p: attRow.present, h: attRow.halfDays, a: attRow.absent, l: attRow.lateCount })})`);
  check('attendance report computes idle % and worked hrs', attRow && attRow.workedHrs === 18 && attRow.idlePct > 0, `(${JSON.stringify(attRow && { w: attRow.workedHrs, i: attRow.idlePct })})`);

  const prod = await req(`/reports/productivity?from=${from}&to=${to}`, { token: saToken });
  const prodRow = (prod.json?.rows ?? []).find((r: any) => r.employee.includes(`emp1.${stamp}`.split('@')[0]));
  check('productivity report matches (1 completed, est 4, actual 5, accuracy 80%)', prodRow && prodRow.tasksCompleted === 1 && prodRow.estimatedHrs === 4 && prodRow.actualHrs === 5 && prodRow.estimateAccuracyPct === 80, `(${JSON.stringify(prodRow && { c: prodRow.tasksCompleted, e: prodRow.estimatedHrs, a: prodRow.actualHrs, acc: prodRow.estimateAccuracyPct })})`);
  check('productivity report captures sent-back count', prodRow && typeof prodRow.sentBackCount === 'number');

  const ps = await req('/reports/project-status', { token: saToken });
  const psRow = (ps.json?.rows ?? []).find((r: any) => r.project === `Alpha ${stamp}`);
  check('project status report: %complete + overdue count', psRow && psRow.overdue === 1 && psRow.pctComplete === 33.33, `(${JSON.stringify(psRow && { o: psRow.overdue, pct: psRow.pctComplete })})`);

  // ── 9. Report exports open correctly (§5.11 CSV/PDF) ──
  const csvRes = await fetch(`${BASE}/reports/attendance/export?format=csv&from=${from}&to=${to}`, { headers: { authorization: `Bearer ${saToken}` } });
  const csvText = await csvRes.text();
  check('attendance CSV export opens with header row', csvRes.headers.get('content-type')?.includes('csv') === true && csvText.startsWith('Employee,Team,Working days'), `(${csvText.slice(0, 40)})`);
  const pdfRes = await fetch(`${BASE}/reports/project-status/export?format=pdf`, { headers: { authorization: `Bearer ${saToken}` } });
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  check('project-status PDF export renders (%PDF)', pdfRes.headers.get('content-type')?.includes('pdf') === true && pdfBuf.subarray(0, 4).toString() === '%PDF' && pdfBuf.length > 500);

  // ── 10. Report scoping: a plain employee sees only their own scope (§5.11) ──
  const empReports = await req('/reports/capacity', { token: emp1Token });
  const ids = Array.isArray(empReports.json) ? empReports.json.map((c: any) => c.userId) : [];
  check('employee capacity is scoped to self (no company-wide leak)', ids.length >= 1 && ids.every((id: string) => id === emp1), `(${ids.length} rows: ${JSON.stringify(ids.slice(0, 3))})`);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
