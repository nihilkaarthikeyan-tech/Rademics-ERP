/**
 * Phase 5 (Files) end-to-end verification.
 * Proves against the RUNNING API + MinIO + ClamAV: presigned upload/download that
 * never streams through the app, versioning that never overwrites, the ClamAV scan
 * pipeline (clean → AVAILABLE, EICAR → INFECTED + quarantined), the client-visible
 * flag + its audit, §24 validation, RBAC (§3/§10), and audit (§5.10).
 * Run: pnpm --filter @rademics/api verify:phase5
 */
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';

const prisma = new PrismaClient();
const BASE = `http://127.0.0.1:${process.env.API_PORT ?? 4000}/api`;
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

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

async function ensureUser(email: string, role: string, password: string) {
  const u = await prisma.user.upsert({
    where: { email },
    update: { status: 'ACTIVE', role: role as any, passwordHash: await argonHash(password) },
    create: { email, name: email.split('@')[0], role: role as any, resourceType: 'INTERNAL', status: 'ACTIVE', passwordHash: await argonHash(password) },
    select: { id: true },
  });
  return u.id;
}

async function uploadAndScan(token: string, target: Record<string, unknown>, filename: string, bytes: Buffer, contentType = 'application/octet-stream') {
  const init = await req('/files/init', { method: 'POST', token, body: { ...target, filename, contentType, sizeBytes: bytes.length } });
  if (init.status >= 300) return { init, put: -1, status: 'INIT_FAILED' };
  const put = await fetch(init.json.uploadUrl, { method: 'PUT', body: bytes });
  await req(`/files/versions/${init.json.versionId}/finalize`, { method: 'POST', token });
  // Poll for the scan verdict.
  let status = 'SCANNING';
  for (let i = 0; i < 40; i++) {
    const s = await req(`/files/versions/${init.json.versionId}/status`, { token });
    status = s.json?.scanStatus;
    if (status === 'AVAILABLE' || status === 'INFECTED' || status === 'ERROR') break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return { init, put: put.status, status };
}

async function main(): Promise<void> {
  console.log(`Verifying Phase 5 against ${BASE}\n`);
  const stamp = Date.now();

  const saToken = await login('admin@rademics.local', 'ChangeMe123!');
  const pmId = await ensureUser(`pm.f${stamp}@rademics.local`, 'PM', 'Password123!');
  await ensureUser(`emp.f${stamp}@rademics.local`, 'EMPLOYEE', 'Password123!');
  const pmToken = await login(`pm.f${stamp}@rademics.local`, 'Password123!');
  const empToken = await login(`emp.f${stamp}@rademics.local`, 'Password123!');
  check('logins', !!saToken && !!pmToken && !!empToken);

  const proj = await req('/projects', { method: 'POST', token: pmToken, body: { name: `Files ${stamp}`, pmId } });
  const task = await req('/tasks', { method: 'POST', token: pmToken, body: { projectId: proj.json.id, title: 'Attach files here' } });
  const taskId = task.json.id;

  // ── Clean upload: presigned PUT → scan → AVAILABLE ──
  const cleanBytes = Buffer.from(`Hello Rademics ${stamp}\n`.repeat(100));
  const clean = await uploadAndScan(pmToken, { taskId }, 'report.pdf', cleanBytes, 'application/pdf');
  check('presigned PUT to MinIO succeeded (direct, not via app)', clean.put === 200, `(PUT ${clean.put})`);
  check('clean file scans AVAILABLE (§5.6)', clean.status === 'AVAILABLE', `(${clean.status})`);
  check('version 1 recorded', clean.init.json?.versionNumber === 1);

  // ── Download the clean version and verify bytes round-trip ──
  const dl = await req(`/files/versions/${clean.init.json.versionId}/download`, { token: pmToken });
  check('download returns a presigned URL', !!dl.json?.url);
  const got = await fetch(dl.json.url);
  const gotBuf = Buffer.from(await got.arrayBuffer());
  check('downloaded bytes match uploaded bytes', gotBuf.equals(cleanBytes), `(${gotBuf.length} vs ${cleanBytes.length})`);

  // ── Versioning: a second upload adds v2, never overwrites v1 ──
  const v2 = await uploadAndScan(pmToken, { fileAssetId: clean.init.json.fileAssetId }, 'report.pdf', Buffer.from('v2 contents'), 'application/pdf');
  check('second upload becomes version 2 (never overwrite, §5.6)', v2.init.json?.versionNumber === 2);
  const versionsInDb = await prisma.fileVersion.count({ where: { fileAssetId: clean.init.json.fileAssetId } });
  check('both versions persist', versionsInDb === 2, `(${versionsInDb})`);

  // ── EICAR: infected → quarantined ──
  const eicar = await uploadAndScan(pmToken, { taskId }, 'eicar.txt', Buffer.from(EICAR), 'text/plain');
  check('EICAR test file is caught and quarantined (§5.6)', eicar.status === 'INFECTED', `(${eicar.status})`);
  const eicarObjGone = (await prisma.fileVersion.findUnique({ where: { id: eicar.init.json.versionId }, select: { scanDetail: true } }))?.scanDetail;
  check('quarantine records the signature', !!eicarObjGone, `(${eicarObjGone})`);
  const dlInfected = await req(`/files/versions/${eicar.init.json.versionId}/download`, { token: pmToken });
  check('infected version cannot be downloaded -> 409', dlInfected.status === 409, `(${dlInfected.status})`);
  const quarantineAudit = await prisma.auditLog.count({ where: { action: 'FILE_QUARANTINED' } });
  check('audit: FILE_QUARANTINED written', quarantineAudit > 0);

  // ── Client-visibility flip (§5.6) + audit + RBAC ──
  const flip = await req(`/files/versions/${clean.init.json.versionId}/visibility`, { method: 'PUT', token: pmToken, body: { visibility: 'CLIENT_VISIBLE' } });
  check('PM flips file to client-visible', flip.json?.visibility === 'CLIENT_VISIBLE', `(${flip.status})`);
  const visAudit = await prisma.auditLog.count({ where: { action: 'FILE_VISIBILITY_CHANGED' } });
  check('audit: FILE_VISIBILITY_CHANGED written', visAudit > 0);
  const empFlip = await req(`/files/versions/${clean.init.json.versionId}/visibility`, { method: 'PUT', token: empToken, body: { visibility: 'INTERNAL' } });
  check('Employee flip visibility -> 403 (files.mark_client_visible denied)', empFlip.status === 403, `(${empFlip.status})`);

  // ── §24 validation ──
  const blocked = await req('/files/init', { method: 'POST', token: pmToken, body: { taskId, filename: 'malware.exe' } });
  check('blocked extension .exe -> 400 (§24)', blocked.status === 400, `(${blocked.status})`);
  const oversize = await req('/files/init', { method: 'POST', token: pmToken, body: { taskId, filename: 'big.pdf', sizeBytes: 200 * 1024 * 1024 } });
  check('oversize upload -> 400 (§24)', oversize.status === 400, `(${oversize.status})`);

  // ── List task files ──
  const list = await req(`/files?taskId=${taskId}`, { token: pmToken });
  check('task file listing returns assets + versions', Array.isArray(list.json) && list.json.length >= 1);

  console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
