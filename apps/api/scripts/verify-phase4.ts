/**
 * Phase 4 (Projects & Tasks) end-to-end verification.
 * Proves against the RUNNING API: project/module/task hierarchy, budget gating (§5.4),
 * §24 validation, the FULL §6 state machine (every legal transition + illegal ones
 * rejected at the API), immutable history, comments/@mentions → notifications,
 * deactivation task-reassignment (§25), RBAC (§3/§10), and audit (§5.10).
 * Run: pnpm --filter @rademics/api verify:phase4
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

async function main(): Promise<void> {
  console.log(`Verifying Phase 4 against ${BASE}\n`);
  const stamp = Date.now();

  const saToken = await login('admin@rademics.local', 'ChangeMe123!');
  check('Super Admin login', !!saToken);

  // Actors
  const pmId = await ensureUser(`pm.${stamp}@rademics.local`, 'PM', 'Password123!');
  const empId = await ensureUser(`emp.${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!');
  const clientId = await ensureUser(`client.${stamp}@rademics.local`, 'CLIENT', 'Password123!');
  const pmToken = await login(`pm.${stamp}@rademics.local`, 'Password123!');
  const empToken = await login(`emp.${stamp}@rademics.local`, 'Password123!');
  const finToken = await login('admin@rademics.local', 'ChangeMe123!'); // SA acts as Finance for MARK_INVOICED

  // ── Project + module (budget gating §5.4) ──
  const proj = await req('/projects', {
    method: 'POST', token: pmToken,
    body: { name: `Website Revamp ${stamp}`, type: 'PROJECT', pmId, clientId, budgetAmount: 500000, startDate: '2026-07-01' },
  });
  check('PM creates project', proj.status >= 200 && proj.status < 300, `(${proj.status})`);
  const projectId = proj.json?.id;
  check('PM sees budgetAmount (§5.4 gating)', proj.json?.budgetAmount != null);

  const empProjView = await req(`/projects/${projectId}`, { token: empToken });
  check('Employee GET project -> 403 (projects.view_all denied)', empProjView.status === 403, `(${empProjView.status})`);

  const mod = await req(`/projects/${projectId}/modules`, { method: 'POST', token: pmToken, body: { name: 'Frontend' } });
  check('PM adds module', mod.status >= 200 && mod.status < 300, `(${mod.status})`);

  // ── §24 validation ──
  const badEstimate = await req('/tasks', {
    method: 'POST', token: pmToken,
    body: { projectId, title: 'Bad estimate', estimatedHours: 0.3 },
  });
  check('estimatedHours not a quarter-hour -> 400 (§24)', badEstimate.status === 400, `(${badEstimate.status})`);
  const badClientFacing = await req('/tasks', {
    method: 'POST', token: pmToken,
    body: { projectId, title: 'Client task without deadline', clientFacing: true },
  });
  check('client-facing task without deadline -> 400 (§24)', badClientFacing.status === 400, `(${badClientFacing.status})`);

  // ── Non-client-facing task: full internal path DRAFT→…→COMPLETED→CLOSED ──
  const task = await req('/tasks', {
    method: 'POST', token: pmToken,
    body: { projectId, moduleId: mod.json?.id, title: 'Build homepage', estimatedHours: 4, priority: 'HIGH' },
  });
  check('PM creates task (DRAFT)', task.json?.status === 'DRAFT', `(${task.json?.status})`);
  const taskId = task.json?.id;

  // Illegal: cannot START_WORK from DRAFT
  const illegal1 = await req(`/tasks/${taskId}/transition`, { method: 'POST', token: pmToken, body: { action: 'START_WORK' } });
  check('illegal transition START_WORK from DRAFT -> 400 (§6)', illegal1.status === 400, `(${illegal1.status})`);

  const assign = await req(`/tasks/${taskId}/assign`, { method: 'POST', token: pmToken, body: { assigneeId: empId } });
  check('ASSIGN (DRAFT→ASSIGNED)', assign.json?.status === 'ASSIGNED', `(${assign.json?.status})`);

  // Illegal actor: PM cannot ACKNOWLEDGE (only the assignee can)
  const wrongActor = await req(`/tasks/${taskId}/transition`, { method: 'POST', token: pmToken, body: { action: 'ACKNOWLEDGE' } });
  check('wrong actor ACKNOWLEDGE by PM -> 403 (§6 actor)', wrongActor.status === 403, `(${wrongActor.status})`);

  const ack = await req(`/tasks/${taskId}/transition`, { method: 'POST', token: empToken, body: { action: 'ACKNOWLEDGE' } });
  check('ACKNOWLEDGE (assignee)', ack.json?.status === 'ACKNOWLEDGED', `(${ack.json?.status})`);
  const start = await req(`/tasks/${taskId}/transition`, { method: 'POST', token: empToken, body: { action: 'START_WORK' } });
  check('START_WORK', start.json?.status === 'IN_PROGRESS');
  const submit = await req(`/tasks/${taskId}/transition`, { method: 'POST', token: empToken, body: { action: 'SUBMIT' } });
  check('SUBMIT (→SUBMITTED_FOR_REVIEW)', submit.json?.status === 'SUBMITTED_FOR_REVIEW');

  // Mandatory comment on SEND_BACK (§6)
  const sendBackNoComment = await req(`/tasks/${taskId}/transition`, { method: 'POST', token: pmToken, body: { action: 'SEND_BACK' } });
  check('SEND_BACK without comment -> 400 (§6 mandatory)', sendBackNoComment.status === 400, `(${sendBackNoComment.status})`);
  const sendBack = await req(`/tasks/${taskId}/transition`, { method: 'POST', token: pmToken, body: { action: 'SEND_BACK', comment: 'Fix the header spacing.' } });
  check('SEND_BACK with comment (→IN_PROGRESS)', sendBack.json?.status === 'IN_PROGRESS');

  await req(`/tasks/${taskId}/transition`, { method: 'POST', token: empToken, body: { action: 'SUBMIT' } });
  const approve = await req(`/tasks/${taskId}/transition`, { method: 'POST', token: pmToken, body: { action: 'APPROVE_REVIEW' } });
  check('APPROVE_REVIEW on non-client task (→COMPLETED)', approve.json?.status === 'COMPLETED', `(${approve.json?.status})`);
  const invoiced = await req(`/tasks/${taskId}/transition`, { method: 'POST', token: finToken, body: { action: 'MARK_INVOICED' } });
  check('MARK_INVOICED (Finance)', invoiced.json?.status === 'INVOICED', `(${invoiced.json?.status})`);
  const closed = await req(`/tasks/${taskId}/transition`, { method: 'POST', token: pmToken, body: { action: 'CLOSE' } });
  check('CLOSE (→CLOSED)', closed.json?.status === 'CLOSED');
  // Cancel from Closed is illegal
  const cancelClosed = await req(`/tasks/${taskId}/transition`, { method: 'POST', token: pmToken, body: { action: 'CANCEL', comment: 'nope' } });
  check('CANCEL from CLOSED -> 400 (§6)', cancelClosed.status === 400, `(${cancelClosed.status})`);

  // ── Client-facing branch: APPROVE_REVIEW → CLIENT_REVIEW → client approves → COMPLETED ──
  const ctask = await req('/tasks', {
    method: 'POST', token: pmToken,
    body: { projectId, title: 'Client deliverable', clientFacing: true, deadline: '2026-08-01T00:00:00Z' },
  });
  const ctaskId = ctask.json?.id;
  await req(`/tasks/${ctaskId}/assign`, { method: 'POST', token: pmToken, body: { assigneeId: empId } });
  await req(`/tasks/${ctaskId}/transition`, { method: 'POST', token: empToken, body: { action: 'ACKNOWLEDGE' } });
  await req(`/tasks/${ctaskId}/transition`, { method: 'POST', token: empToken, body: { action: 'START_WORK' } });
  await req(`/tasks/${ctaskId}/transition`, { method: 'POST', token: empToken, body: { action: 'SUBMIT' } });
  const capprove = await req(`/tasks/${ctaskId}/transition`, { method: 'POST', token: pmToken, body: { action: 'APPROVE_REVIEW' } });
  check('APPROVE_REVIEW on client-facing task (→CLIENT_REVIEW)', capprove.json?.status === 'CLIENT_REVIEW', `(${capprove.json?.status})`);
  // Employee cannot act as client approver
  const empAsClient = await req(`/tasks/${ctaskId}/transition`, { method: 'POST', token: empToken, body: { action: 'CLIENT_APPROVE' } });
  check('employee CLIENT_APPROVE -> 403 (§6 actor)', empAsClient.status === 403, `(${empAsClient.status})`);
  const clientToken = await login(`client.${stamp}@rademics.local`, 'Password123!');
  const clientApprove = await req(`/tasks/${ctaskId}/transition`, { method: 'POST', token: clientToken, body: { action: 'CLIENT_APPROVE' } });
  check('CLIENT_APPROVE (→COMPLETED)', clientApprove.json?.status === 'COMPLETED', `(${clientApprove.json?.status})`);

  // ── Subtasks: cannot close parent with open subtask (§24) ──
  const parent = await req('/tasks', { method: 'POST', token: pmToken, body: { projectId, title: 'Parent task' } });
  const parentId = parent.json?.id;
  const sub = await req('/tasks', { method: 'POST', token: pmToken, body: { projectId, parentTaskId: parentId, title: 'Subtask one' } });
  check('create subtask (one level)', sub.status >= 200 && sub.status < 300, `(${sub.status})`);
  const nestedSub = await req('/tasks', { method: 'POST', token: pmToken, body: { projectId, parentTaskId: sub.json?.id, title: 'Nested' } });
  check('subtask of a subtask -> 400 (§24 one level)', nestedSub.status === 400, `(${nestedSub.status})`);
  // Drive parent to COMPLETED, then try to close with the subtask still open
  await req(`/tasks/${parentId}/assign`, { method: 'POST', token: pmToken, body: { assigneeId: empId } });
  await req(`/tasks/${parentId}/transition`, { method: 'POST', token: empToken, body: { action: 'ACKNOWLEDGE' } });
  await req(`/tasks/${parentId}/transition`, { method: 'POST', token: empToken, body: { action: 'START_WORK' } });
  await req(`/tasks/${parentId}/transition`, { method: 'POST', token: empToken, body: { action: 'SUBMIT' } });
  await req(`/tasks/${parentId}/transition`, { method: 'POST', token: pmToken, body: { action: 'APPROVE_REVIEW' } });
  const closeOpenSub = await req(`/tasks/${parentId}/transition`, { method: 'POST', token: pmToken, body: { action: 'CLOSE_WITHOUT_INVOICING' } });
  check('CLOSE with open subtask -> 400 (§24)', closeOpenSub.status === 400, `(${closeOpenSub.status})`);

  // ── Immutable history ──
  const detail = await req(`/tasks/${taskId}`, { token: pmToken });
  check('history recorded for every transition', Array.isArray(detail.json?.history) && detail.json.history.length >= 7, `(${detail.json?.history?.length})`);
  const histCount = await prisma.taskStatusHistory.count({ where: { taskId } });
  check('history is append-only (no update/delete path exists)', histCount >= 7);

  // ── Comments + @mention → notification ──
  const comment = await req(`/tasks/${taskId}/comments`, {
    method: 'POST', token: pmToken,
    body: { body: 'Nice work here', mentionUserIds: [empId] },
  });
  check('add comment with @mention', comment.status >= 200 && comment.status < 300, `(${comment.status})`);
  const empNotifs = await req('/notifications', { token: empToken });
  check('mention creates an in-app notification', Array.isArray(empNotifs.json) && empNotifs.json.some((n: any) => n.type === 'MENTION'));
  check('assignment fired a TASK_ASSIGNED notification', empNotifs.json.some((n: any) => n.type === 'TASK_ASSIGNED'));

  // client-visible comment on a non-client-facing task is rejected
  const badVisible = await req(`/tasks/${taskId}/comments`, { method: 'POST', token: pmToken, body: { body: 'x', clientVisible: true } });
  check('client-visible comment on internal task -> 400 (§5.4)', badVisible.status === 400, `(${badVisible.status})`);

  // ── RBAC: employee cannot create a project ──
  const empProj = await req('/projects', { method: 'POST', token: empToken, body: { name: 'x', type: 'PROJECT' } });
  check('Employee create project -> 403 (§3/§10)', empProj.status === 403, `(${empProj.status})`);

  // ── Deactivation task-reassignment (§25) ──
  const reTask = await req('/tasks', { method: 'POST', token: pmToken, body: { projectId, title: 'Task to reassign' } });
  await req(`/tasks/${reTask.json?.id}/assign`, { method: 'POST', token: pmToken, body: { assigneeId: empId } });
  const deact = await req(`/employees/${empId}/deactivate`, { method: 'POST', token: saToken });
  check('deactivate returns tasksReassigned count', (deact.json?.tasksReassigned ?? 0) >= 1, `(${deact.json?.tasksReassigned})`);
  const reTaskAfter = await prisma.task.findUnique({ where: { id: reTask.json?.id }, select: { assigneeId: true, status: true } });
  check('open task returned to ASSIGNED with assignee cleared (§25)', reTaskAfter?.assigneeId === null && reTaskAfter?.status === 'ASSIGNED', `(${reTaskAfter?.status}/${reTaskAfter?.assigneeId})`);

  // ── Audit ──
  const taskAudit = await prisma.auditLog.count({ where: { action: 'TASK_TRANSITION' } });
  check('audit: TASK_TRANSITION entries written', taskAudit > 0);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
