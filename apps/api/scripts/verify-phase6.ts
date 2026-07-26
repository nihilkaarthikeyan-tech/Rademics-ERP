/**
 * Phase 6 (Client Portal) end-to-end verification.
 * Proves against the RUNNING API: multi-user client orgs, strict per-project scoping
 * (cross-org id → 404, enumeration impossible §10), no internal-data leaks,
 * the client-visible progress feed, "ask for a status update" (2026-07-27, with
 * its cooldown), client-visible file read-path, and org-deactivation
 * "access ended" (§25).
 *
 * 2026-07-27: the client has NO approval power — no approve, no
 * request-revision, no Viewer/Approver distinction. Those endpoints are gone;
 * this script asserts they stay gone (404/410, never silently re-added).
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

/** Drives a client-facing task to COMPLETED — an internal-only approval now,
 *  no client step in the middle. Used to have real content for the client to view. */
async function driveClientFacingTaskToCompleted(pmToken: string, empToken: string, projectId: string, empId: string, title: string) {
  const task = await req('/tasks', { method: 'POST', token: pmToken, body: { projectId, title, clientFacing: true, deadline: '2026-09-01T00:00:00Z' } });
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

  // Self-sufficient: create our own SA — demo credentials change, stamps don't.
  await ensureUser(`sa.${stamp}@rademics.local`, 'SUPER_ADMIN', 'Password123!');
  const saToken = await login(`sa.${stamp}@rademics.local`, 'Password123!');
  check('Super Admin login', !!saToken);
  const pmId = await ensureUser(`pm.p${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!');
  const empId = await ensureUser(`emp.p${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!');
  const pmToken = await login(`pm.p${stamp}@rademics.local`, 'Password123!');
  const empToken = await login(`emp.p${stamp}@rademics.local`, 'Password123!');

  // Two client orgs (admin endpoint).
  const org1 = await req('/client-orgs', { method: 'POST', token: saToken, body: { name: `Acme College ${stamp}` } });
  const org2 = await req('/client-orgs', { method: 'POST', token: saToken, body: { name: `Beta University ${stamp}` } });
  check('create two client orgs (portal.users.manage)', org1.status < 300 && org2.status < 300, `(${org1.status}/${org2.status})`);

  // Client users (individual logins — §2). Two in org1, one in org2 — no more
  // Viewer/Approver distinction (2026-07-27): every grant is the same shape.
  const client1a = await ensureUser(`client1a.${stamp}@client.local`, 'CLIENT', 'Client123!', { clientOrgId: org1.json.id });
  const client1b = await ensureUser(`client1b.${stamp}@client.local`, 'CLIENT', 'Client123!', { clientOrgId: org1.json.id });
  const client2 = await ensureUser(`client2.${stamp}@client.local`, 'CLIENT', 'Client123!', { clientOrgId: org2.json.id });
  const client1aToken = await login(`client1a.${stamp}@client.local`, 'Client123!');
  const client1bToken = await login(`client1b.${stamp}@client.local`, 'Client123!');
  const client2Token = await login(`client2.${stamp}@client.local`, 'Client123!');

  // Admin invite endpoint works too.
  const invited = await req(`/client-orgs/${org1.json.id}/users`, { method: 'POST', token: saToken, body: { email: `invited.${stamp}@client.local`, name: 'Invited User' } });
  check('invite a client user into an org', invited.status < 300, `(${invited.status})`);

  // Two projects — created by SA appointing pmId as manager (project creation
  // is SA/HR-only since the PM role was removed, 2026-07-25).
  const p1 = await req('/projects', { method: 'POST', token: saToken, body: { name: `Project One ${stamp}`, pmId } });
  const p2 = await req('/projects', { method: 'POST', token: saToken, body: { name: `Project Two ${stamp}`, pmId } });
  check('SA creates both projects appointing the manager', p1.status < 300 && p2.status < 300, `(${p1.status}/${p2.status})`);
  const p1Id = p1.json.id, p2Id = p2.json.id;

  // Grant: both org1 clients on P1; org2 client on P2. No `level` any more.
  await req('/client-orgs/access', { method: 'POST', token: saToken, body: { projectId: p1Id, clientUserId: client1a } });
  await req('/client-orgs/access', { method: 'POST', token: saToken, body: { projectId: p1Id, clientUserId: client1b } });
  const grant = await req('/client-orgs/access', { method: 'POST', token: saToken, body: { projectId: p2Id, clientUserId: client2 } });
  check('grant per-project access (no level — view + request-status only)', grant.status < 300, `(${grant.status})`);

  // ── Isolation (§5.5, §10) ──
  const list1 = await req('/portal/projects', { token: client1aToken });
  check('client sees only their scoped project', Array.isArray(list1.json) && list1.json.length === 1 && list1.json[0].id === p1Id, `(${JSON.stringify(list1.json?.map((p: any) => p.id))})`);
  const cross = await req(`/portal/projects/${p2Id}`, { token: client1aToken });
  check('cross-org project id -> 404 (enumeration impossible)', cross.status === 404, `(${cross.status})`);
  const cross2 = await req(`/portal/projects/${p1Id}`, { token: client2Token });
  check('other org cannot read P1 -> 404', cross2.status === 404, `(${cross2.status})`);

  // Internal role cannot touch the portal surface at all.
  const saPortal = await req('/portal/projects', { token: saToken });
  check('Super Admin GET /portal/projects -> 403 (portal is client-only)', saPortal.status === 403, `(${saPortal.status})`);

  // ── No approval surface exists any more (2026-07-27) ──
  check('GET /portal/deliverables no longer exists', (await req('/portal/deliverables', { token: client1aToken })).status === 404);
  check('GET /portal/invoices no longer exists', (await req('/portal/invoices', { token: client1aToken })).status === 404);
  const someTaskId = await driveClientFacingTaskToCompleted(pmToken, empToken, p1Id, empId, 'Client-facing deliverable');
  check('POST /portal/deliverables/:id/approve no longer exists', (await req(`/portal/deliverables/${someTaskId}/approve`, { method: 'POST', token: client1aToken, body: {} })).status === 404);
  check('POST /portal/deliverables/:id/request-revision no longer exists', (await req(`/portal/deliverables/${someTaskId}/request-revision`, { method: 'POST', token: client1aToken, body: {} })).status === 404);

  // ── Client-facing task completes via internal approval only, client just sees it ──
  const proj1 = await req(`/portal/projects/${p1Id}`, { token: client1aToken });
  check('scoped project view returns progress + items (no deliverables/level fields)', proj1.json?.percentComplete !== undefined && Array.isArray(proj1.json?.items) && proj1.json?.level === undefined);
  check('no internal data leaks (no assignee field in response)', !JSON.stringify(proj1.json).includes('assignee'), '(assignee leaked)');
  const seenTask = proj1.json.items.find((t: any) => t.id === someTaskId);
  check('the completed client-facing task shows as COMPLETED to the client', seenTask?.status === 'COMPLETED', `(${seenTask?.status})`);

  // ── Progress feed: staff shares an update, client reads it (2026-07-27) ──
  const comment = await req(`/tasks/${someTaskId}/comments`, { method: 'POST', token: pmToken, body: { body: 'All pages proofed, sending for print.', clientVisible: true } });
  check('staff posts a client-visible update', comment.status < 300, `(${comment.status})`);
  const updates = await req(`/portal/tasks/${someTaskId}/updates`, { token: client1aToken });
  check('client reads the update feed, attributed by name', Array.isArray(updates.json) && updates.json.some((u: any) => u.body.includes('sending for print') && u.authorName), `(${JSON.stringify(updates.json)})`);
  const otherOrgUpdates = await req(`/portal/tasks/${someTaskId}/updates`, { token: client2Token });
  check('other org cannot read this task\'s updates -> 404', otherOrgUpdates.status === 404, `(${otherOrgUpdates.status})`);

  // ── "Ask for a status update" — any client on the project, plus a cooldown ──
  const reqStatus = await req(`/portal/tasks/${someTaskId}/request-status`, { method: 'POST', token: client1bToken, body: {} });
  check('a second client user on the same project can request status', reqStatus.status < 300 && reqStatus.json?.requested === true, `(${reqStatus.status})`);
  const assigneeNotified = await prisma.notification.count({ where: { userId: empId, type: 'CLIENT_STATUS_REQUESTED' } });
  check('assignee notified of the status request', assigneeNotified > 0);
  const immediateRepeat = await req(`/portal/tasks/${someTaskId}/request-status`, { method: 'POST', token: client1aToken, body: {} });
  check('immediate repeat request is refused by the cooldown', immediateRepeat.status === 400, `(${immediateRepeat.status})`);
  const otherOrgRequest = await req(`/portal/tasks/${someTaskId}/request-status`, { method: 'POST', token: client2Token, body: {} });
  check('other org cannot request status on P1\'s task -> 404', otherOrgRequest.status === 404, `(${otherOrgRequest.status})`);

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
