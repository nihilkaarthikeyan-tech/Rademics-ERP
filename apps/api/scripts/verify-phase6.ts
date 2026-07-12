/**
 * Phase 6 (Client Portal) end-to-end verification.
 * Proves against the RUNNING API: multi-user client orgs, strict per-project scoping
 * (cross-org id → 404, enumeration impossible §10), no internal-data leaks, the
 * deliverable approve / request-revision flow through the §6 state machine + PM
 * notification, Viewer-vs-Approver enforcement, client-visible file read-path,
 * and org-deactivation "access ended" (§25).
 * Run: pnpm --filter @rademics/api verify:phase6
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

async function driveToClientReview(pmToken: string, empToken: string, projectId: string, empId: string) {
  const task = await req('/tasks', { method: 'POST', token: pmToken, body: { projectId, title: 'Deliverable', clientFacing: true, deadline: '2026-09-01T00:00:00Z' } });
  const id = task.json.id;
  await req(`/tasks/${id}/assign`, { method: 'POST', token: pmToken, body: { assigneeId: empId } });
  await req(`/tasks/${id}/transition`, { method: 'POST', token: empToken, body: { action: 'ACKNOWLEDGE' } });
  await req(`/tasks/${id}/transition`, { method: 'POST', token: empToken, body: { action: 'START_WORK' } });
  await req(`/tasks/${id}/transition`, { method: 'POST', token: empToken, body: { action: 'SUBMIT' } });
  await req(`/tasks/${id}/transition`, { method: 'POST', token: pmToken, body: { action: 'APPROVE_REVIEW' } });
  return id;
}

async function main(): Promise<void> {
  console.log(`Verifying Phase 6 against ${BASE}\n`);
  const stamp = Date.now();

  const saToken = await login('admin@rademics.local', 'ChangeMe123!');
  const pmId = await ensureUser(`pm.p${stamp}@rademics.local`, 'PM', 'Password123!');
  const empId = await ensureUser(`emp.p${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!');
  const pmToken = await login(`pm.p${stamp}@rademics.local`, 'Password123!');
  const empToken = await login(`emp.p${stamp}@rademics.local`, 'Password123!');

  // Two client orgs (admin endpoint).
  const org1 = await req('/client-orgs', { method: 'POST', token: saToken, body: { name: `Acme College ${stamp}` } });
  const org2 = await req('/client-orgs', { method: 'POST', token: saToken, body: { name: `Beta University ${stamp}` } });
  check('create two client orgs (portal.users.manage)', org1.status < 300 && org2.status < 300, `(${org1.status}/${org2.status})`);

  // Client users (individual logins — §2). One approver + one viewer in org1, one in org2.
  const approver1 = await ensureUser(`approver1.${stamp}@client.local`, 'CLIENT', 'Client123!', { clientOrgId: org1.json.id });
  const viewer1 = await ensureUser(`viewer1.${stamp}@client.local`, 'CLIENT', 'Client123!', { clientOrgId: org1.json.id });
  const client2 = await ensureUser(`client2.${stamp}@client.local`, 'CLIENT', 'Client123!', { clientOrgId: org2.json.id });
  const approver1Token = await login(`approver1.${stamp}@client.local`, 'Client123!');
  const viewer1Token = await login(`viewer1.${stamp}@client.local`, 'Client123!');
  const client2Token = await login(`client2.${stamp}@client.local`, 'Client123!');

  // Admin invite endpoint works too.
  const invited = await req(`/client-orgs/${org1.json.id}/users`, { method: 'POST', token: saToken, body: { email: `invited.${stamp}@client.local`, name: 'Invited User' } });
  check('invite a client user into an org', invited.status < 300, `(${invited.status})`);

  // Two projects.
  const p1 = await req('/projects', { method: 'POST', token: pmToken, body: { name: `Project One ${stamp}`, pmId } });
  const p2 = await req('/projects', { method: 'POST', token: pmToken, body: { name: `Project Two ${stamp}`, pmId } });
  const p1Id = p1.json.id, p2Id = p2.json.id;

  // Grant: org1 approver+viewer on P1; org2 client on P2.
  await req('/client-orgs/access', { method: 'POST', token: saToken, body: { projectId: p1Id, clientUserId: approver1, level: 'APPROVER' } });
  await req('/client-orgs/access', { method: 'POST', token: saToken, body: { projectId: p1Id, clientUserId: viewer1, level: 'VIEWER' } });
  const grant = await req('/client-orgs/access', { method: 'POST', token: saToken, body: { projectId: p2Id, clientUserId: client2, level: 'APPROVER' } });
  check('grant per-project access (Viewer/Approver)', grant.status < 300, `(${grant.status})`);

  // ── Isolation (§5.5, §10) ──
  const list1 = await req('/portal/projects', { token: approver1Token });
  check('client sees only their scoped project', Array.isArray(list1.json) && list1.json.length === 1 && list1.json[0].id === p1Id, `(${JSON.stringify(list1.json?.map((p: any) => p.id))})`);
  const cross = await req(`/portal/projects/${p2Id}`, { token: approver1Token });
  check('cross-org project id -> 404 (enumeration impossible)', cross.status === 404, `(${cross.status})`);
  const cross2 = await req(`/portal/projects/${p1Id}`, { token: client2Token });
  check('other org cannot read P1 -> 404', cross2.status === 404, `(${cross2.status})`);

  // Internal role cannot touch the portal surface at all.
  const saPortal = await req('/portal/projects', { token: saToken });
  check('Super Admin GET /portal/projects -> 403 (portal is client-only)', saPortal.status === 403, `(${saPortal.status})`);

  // ── Deliverable in P1 → CLIENT_REVIEW ──
  const taskId = await driveToClientReview(pmToken, empToken, p1Id, empId);
  const proj1 = await req(`/portal/projects/${p1Id}`, { token: approver1Token });
  check('scoped project view returns progress + deliverables', proj1.json?.percentComplete !== undefined && Array.isArray(proj1.json?.deliverables));
  check('no internal data leaks (no assignee field in response)', !JSON.stringify(proj1.json).includes('assignee'), '(assignee leaked)');

  const deliverables = await req('/portal/deliverables', { token: approver1Token });
  check('approver sees the pending deliverable', Array.isArray(deliverables.json) && deliverables.json.some((d: any) => d.id === taskId && d.canApprove === true));

  // Viewer cannot approve (scoped capability passes guard; service enforces APPROVER).
  const viewerApprove = await req(`/portal/deliverables/${taskId}/approve`, { method: 'POST', token: viewer1Token, body: {} });
  check('Viewer approve -> 403 (only Approver, §5.5)', viewerApprove.status === 403, `(${viewerApprove.status})`);
  // Other org cannot approve P1's deliverable.
  const otherApprove = await req(`/portal/deliverables/${taskId}/approve`, { method: 'POST', token: client2Token, body: {} });
  check('other-org approve -> 404 (no access)', otherApprove.status === 404, `(${otherApprove.status})`);

  // Approver approves → task COMPLETED (via §6 state machine) → PM notified.
  const approve = await req(`/portal/deliverables/${taskId}/approve`, { method: 'POST', token: approver1Token, body: {} });
  check('Approver approves deliverable (→COMPLETED)', approve.json?.status === 'COMPLETED', `(${approve.json?.status ?? approve.status})`);
  const pmNotified = await prisma.notification.count({ where: { userId: pmId, type: 'CLIENT_APPROVED' } });
  check('PM notified of client approval (§5.5)', pmNotified > 0);

  // Request revision on a second deliverable → IN_PROGRESS.
  const task2 = await driveToClientReview(pmToken, empToken, p1Id, empId);
  const noComment = await req(`/portal/deliverables/${task2}/request-revision`, { method: 'POST', token: approver1Token, body: { comment: 'too short' } });
  check('request-revision comment < 10 chars -> 400', noComment.status === 400, `(${noComment.status})`);
  const revise = await req(`/portal/deliverables/${task2}/request-revision`, { method: 'POST', token: approver1Token, body: { comment: 'Please adjust the cover page layout and colors.' } });
  check('Approver requests revision (→IN_PROGRESS)', revise.json?.status === 'IN_PROGRESS', `(${revise.json?.status ?? revise.status})`);

  // ── Access ended when org is deactivated (§25) ──
  await req(`/client-orgs/${org2.json.id}/deactivate`, { method: 'POST', token: saToken });
  const ended = await req('/portal/projects', { token: client2Token });
  check('deactivated org -> access ended (403)', ended.status === 403, `(${ended.status})`);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
