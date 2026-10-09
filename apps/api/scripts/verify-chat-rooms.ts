/**
 * Chat rooms: groups (HR / Super Admin only) and one-to-one conversations,
 * end to end against the RUNNING API. Proves who may create and manage
 * groups, that private rooms are readable only by members (messages, pins,
 * files), that direct chats are unique per pair, and that unread counts are
 * per room.
 * Run: pnpm --filter @rademics/api verify:chat-rooms
 */
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';

const prisma = new PrismaClient();
const BASE = `http://127.0.0.1:${process.env.API_PORT ?? 4000}/api`;
const COMPANY = '00000000-0000-4000-8000-000000000001';

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

async function user(email: string, name: string, role: string): Promise<{ id: string; token: string }> {
  const password = 'ChatVerify123!';
  const { id } = await prisma.user.upsert({
    where: { email },
    update: { status: 'ACTIVE', role: role as any, name, passwordHash: await argonHash(password), failedLoginCount: 0, lockedUntil: null },
    create: { email, name, role: role as any, resourceType: 'INTERNAL', status: 'ACTIVE', passwordHash: await argonHash(password) },
    select: { id: true },
  });
  const r = await req('/auth/login', { method: 'POST', body: { email, password } });
  return { id, token: r.json?.accessToken as string };
}

async function main(): Promise<void> {
  console.log(`Verifying chat rooms against ${BASE}\n`);
  const hr = await user('verify.chat.hr@rademics.local', 'Chat Verify HR', 'HR');
  const a = await user('verify.chat.a@rademics.local', 'Chat Verify Asha', 'EMPLOYEE');
  const b = await user('verify.chat.b@rademics.local', 'Chat Verify Bala', 'EMPLOYEE');
  const c = await user('verify.chat.c@rademics.local', 'Chat Verify Charu', 'EMPLOYEE');
  check('Test users signed in', [hr, a, b, c].every((u) => u.token));
  // Clean slate for these people's private rooms.
  await prisma.chatRoom.deleteMany({ where: { kind: { not: 'COMPANY' }, members: { some: { userId: { in: [hr.id, a.id, b.id, c.id] } } } } });

  console.log('\n— Groups');
  const denied = await req('/chat/rooms', { method: 'POST', token: a.token, body: { name: 'Not allowed', memberIds: [b.id] } });
  check('An employee cannot create a group (403)', denied.status === 403, `(${denied.status})`);
  const group = await req('/chat/rooms', { method: 'POST', token: hr.token, body: { name: 'Research team', memberIds: [a.id, b.id] } });
  check('HR creates a group', group.status < 300 && group.json?.kind === 'GROUP', `(${group.status} ${JSON.stringify(group.json)})`);
  const gid = group.json?.id as string;
  const members = await req(`/chat/rooms/${gid}/members`, { token: a.token });
  check('Group has HR plus the two people added', members.json?.length === 3, `(${members.json?.length})`);

  const sent = await req('/chat/messages', { method: 'POST', token: a.token, body: { body: 'Hello research team', roomId: gid } });
  check('A member can post in the group', sent.status < 300 && sent.json?.roomId === gid, `(${sent.status})`);
  const outsiderRead = await req(`/chat/messages?roomId=${gid}`, { token: c.token });
  check('A non-member cannot read the group (404)', outsiderRead.status === 404, `(${outsiderRead.status})`);
  const outsiderPost = await req('/chat/messages', { method: 'POST', token: c.token, body: { body: 'sneaking in', roomId: gid } });
  check('A non-member cannot post in the group (404)', outsiderPost.status === 404, `(${outsiderPost.status})`);
  const outsiderReact = await req(`/chat/messages/${sent.json?.id}/reactions`, { method: 'POST', token: c.token, body: { emoji: '👍' } });
  check('A non-member cannot react to a group message (404)', outsiderReact.status === 404, `(${outsiderReact.status})`);
  const cRooms = await req('/chat/rooms', { token: c.token });
  check("The group is not in a non-member's list", !cRooms.json?.some((r: any) => r.id === gid));

  const bRooms = await req('/chat/rooms', { token: b.token });
  const bGroup = bRooms.json?.find((r: any) => r.id === gid);
  check('The other member sees it with 1 unread', bGroup?.unread === 1, `(${bGroup?.unread})`);
  await req(`/chat/read?roomId=${gid}`, { method: 'POST', token: b.token, body: {} });
  const bAfter = (await req('/chat/rooms', { token: b.token })).json?.find((r: any) => r.id === gid);
  check('Reading the group clears its unread count', bAfter?.unread === 0, `(${bAfter?.unread})`);

  const addDenied = await req(`/chat/rooms/${gid}/members`, { method: 'POST', token: a.token, body: { memberIds: [c.id] } });
  check('An employee cannot add people (403)', addDenied.status === 403, `(${addDenied.status})`);
  const added = await req(`/chat/rooms/${gid}/members`, { method: 'POST', token: hr.token, body: { memberIds: [c.id] } });
  check('HR adds a person', added.status < 300 && added.json?.length === 4, `(${added.status} ${added.json?.length})`);
  const cNow = await req(`/chat/messages?roomId=${gid}`, { token: c.token });
  check('The added person can now read the history', cNow.status === 200 && cNow.json?.items?.length === 1, `(${cNow.status})`);
  const removed = await req(`/chat/rooms/${gid}/members/${c.id}`, { method: 'DELETE', token: hr.token });
  check('HR removes a person', removed.status < 300, `(${removed.status})`);
  const cGone = await req(`/chat/messages?roomId=${gid}`, { token: c.token });
  check('The removed person loses access (404)', cGone.status === 404, `(${cGone.status})`);

  console.log('\n— Mention links');
  const ping = await req('/chat/messages', { method: 'POST', token: hr.token, body: { body: '@Chat Verify Asha please check this', roomId: gid } });
  const note = await prisma.notification.findFirst({
    where: { userId: a.id, entityType: 'ChatMessage', entityId: ping.json?.id },
    select: { title: true },
  });
  check('A mention in a group notifies that person, naming the group', Boolean(note?.title.includes('Research team')), JSON.stringify(note));
  const found = await req(`/chat/messages/${ping.json?.id}/locate`, { token: a.token });
  check('The notification link finds the right group', found.json?.roomId === gid, JSON.stringify(found.json));
  const hidden = await req(`/chat/messages/${ping.json?.id}/locate`, { token: c.token });
  check('Someone outside the group cannot locate it (404)', hidden.status === 404, `(${hidden.status})`);

  console.log('\n— Message text is encrypted at rest');
  const raw = await prisma.chatMessage.findUnique({ where: { id: sent.json?.id }, select: { body: true } });
  check('Stored text is encrypted, not readable in the database', Boolean(raw?.body.startsWith('v1.') && !raw.body.includes('research')), raw?.body.slice(0, 20));
  const readBack = await req(`/chat/messages?roomId=${gid}`, { token: b.token });
  check('Members still read it normally in the app', readBack.json?.items?.some((m: any) => m.body === 'Hello research team'));
  const empSearch = await req('/search?q=chat%20verify', { token: a.token });
  const hrSearch = await req('/search?q=chat%20verify', { token: hr.token });
  check('Employees find colleagues by name without seeing emails', empSearch.json?.people?.length > 0 && !empSearch.json.people.some((p: any) => p.email), JSON.stringify(empSearch.json?.people?.[0]));
  check('HR still sees work emails in search', hrSearch.json?.people?.some((p: any) => p.email));

  console.log('\n— Replies, read receipts, mute, search');
  const reply = await req('/chat/messages', { method: 'POST', token: b.token, body: { body: 'Sure, on it', roomId: gid, replyToId: sent.json?.id } });
  check('A reply quotes the original', reply.json?.replyTo?.id === sent.json?.id && reply.json?.replyTo?.body === 'Hello research team', JSON.stringify(reply.json?.replyTo));
  const companyMsg = await req('/chat/messages', { method: 'POST', token: hr.token, body: { body: 'company note for reply test' } });
  const crossReply = await req('/chat/messages', { method: 'POST', token: a.token, body: { body: 'sneaky', roomId: gid, replyToId: companyMsg.json?.id } });
  check('You cannot quote a message from another conversation (400)', crossReply.status === 400, `(${crossReply.status})`);
  await prisma.chatMessage.deleteMany({ where: { id: companyMsg.json?.id } });

  await req(`/chat/read?roomId=${gid}`, { method: 'POST', token: a.token, body: {} });
  const reads = await req(`/chat/rooms/${gid}/reads`, { token: b.token });
  const aRead = reads.json?.find((r: any) => r.userId === a.id);
  check('Read receipts show how far each member has read', Boolean(aRead && new Date(aRead.lastReadAt) >= new Date(reply.json?.createdAt)), JSON.stringify(aRead));
  const outsiderReads = await req(`/chat/rooms/${gid}/reads`, { token: c.token });
  check('Someone outside the group cannot see its read receipts (404)', outsiderReads.status === 404, `(${outsiderReads.status})`);

  const before = (await req('/chat/unread-count', { token: a.token })).json?.count ?? 0;
  await req('/chat/messages', { method: 'POST', token: hr.token, body: { body: 'one more for the badge', roomId: gid } });
  const withNew = (await req('/chat/unread-count', { token: a.token })).json?.count ?? 0;
  const muted = await req(`/chat/rooms/${gid}/mute`, { method: 'POST', token: a.token, body: { muted: true } });
  const afterMute = (await req('/chat/unread-count', { token: a.token })).json?.count ?? 0;
  const mutedRoom = (await req('/chat/rooms', { token: a.token })).json?.find((r: any) => r.id === gid);
  check('Muting a group takes it out of the nav badge', muted.status < 300 && withNew === before + 1 && afterMute === before && mutedRoom?.muted === true, `(${before} → ${withNew} → ${afterMute})`);
  await req(`/chat/rooms/${gid}/mute`, { method: 'POST', token: a.token, body: { muted: false } });

  const found2 = await req(`/chat/search?q=${encodeURIComponent('research team')}`, { token: a.token });
  check('Search finds a message in your group', found2.json?.some((m: any) => m.id === sent.json?.id && m.roomName === 'Research team'), JSON.stringify(found2.json?.slice?.(0, 2)));
  const found3 = await req(`/chat/search?q=${encodeURIComponent('research team')}`, { token: c.token });
  check("Search never shows messages from someone else's group", !found3.json?.some((m: any) => m.roomId === gid), JSON.stringify(found3.json));

  console.log('\n— Files, forward, schedule, storage');
  const files = await req(`/chat/rooms/${gid}/files`, { token: a.token });
  check('A member can list the files shared in the group', files.status === 200 && Array.isArray(files.json), `(${files.status})`);
  const outsiderFiles = await req(`/chat/rooms/${gid}/files`, { token: c.token });
  check("Someone outside the group can't list its files (404)", outsiderFiles.status === 404, `(${outsiderFiles.status})`);

  const fwdDm = await req('/chat/direct', { method: 'POST', token: a.token, body: { userId: b.id } });
  const fwd = await req(`/chat/messages/${sent.json?.id}/forward`, { method: 'POST', token: a.token, body: { roomId: fwdDm.json?.id } });
  check('Forwarding copies the message into another chat', fwd.status < 300 && fwd.json?.forwarded === true && fwd.json?.body === 'Hello research team', JSON.stringify(fwd.json));
  const fwdSteal = await req(`/chat/messages/${sent.json?.id}/forward`, { method: 'POST', token: c.token, body: { roomId: COMPANY } });
  check("You can't forward a message from a group you're not in (404)", fwdSteal.status === 404, `(${fwdSteal.status})`);

  const soon = await req('/chat/scheduled', { method: 'POST', token: a.token, body: { body: 'too soon', roomId: gid, sendAt: new Date(Date.now() + 5_000).toISOString() } });
  check('A message must be scheduled at least a minute ahead (400)', soon.status === 400, `(${soon.status})`);
  const sched = await req('/chat/scheduled', { method: 'POST', token: a.token, body: { body: 'Scheduled hello', roomId: gid, sendAt: new Date(Date.now() + 120_000).toISOString() } });
  const mine2 = await req(`/chat/scheduled?roomId=${gid}`, { token: a.token });
  check('A scheduled message waits in your list', sched.status < 300 && mine2.json?.some((s: any) => s.id === sched.json?.id), `(${sched.status})`);
  await prisma.chatScheduledMessage.update({ where: { id: sched.json?.id }, data: { sendAt: new Date(Date.now() - 1000) } });
  let delivered = false;
  for (let i = 0; i < 25 && !delivered; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const row = await prisma.chatScheduledMessage.findUnique({ where: { id: sched.json?.id }, select: { messageId: true } });
    delivered = Boolean(row?.messageId);
  }
  const bSees = await req(`/chat/messages?roomId=${gid}`, { token: b.token });
  check('When its time comes it is posted as the author', delivered && bSees.json?.items?.some((m: any) => m.body === 'Scheduled hello' && m.author?.id === a.id));
  const sched2 = await req('/chat/scheduled', { method: 'POST', token: a.token, body: { body: 'never mind', roomId: gid, sendAt: new Date(Date.now() + 600_000).toISOString() } });
  const cancelOther = await req(`/chat/scheduled/${sched2.json?.id}`, { method: 'DELETE', token: b.token });
  const cancelOwn = await req(`/chat/scheduled/${sched2.json?.id}`, { method: 'DELETE', token: a.token });
  check("Only the author can cancel a scheduled message", cancelOther.status === 404 && cancelOwn.status < 300, `(${cancelOther.status}/${cancelOwn.status})`);

  const storageDenied = await req('/chat/storage', { token: a.token });
  const storage = await req('/chat/storage', { token: hr.token });
  check('Only HR / admins see the chat storage summary', storageDenied.status === 403 && storage.status === 200 && typeof storage.json?.uploadLimitBytes === 'number', `(${storageDenied.status}/${storage.status})`);

  console.log('\n— Rename and delete a group');
  const renameDenied = await req(`/chat/rooms/${gid}`, { method: 'PATCH', token: a.token, body: { name: 'Hijacked' } });
  const renamed = await req(`/chat/rooms/${gid}`, { method: 'PATCH', token: hr.token, body: { name: 'Research & writing' } });
  const aList = (await req('/chat/rooms', { token: a.token })).json ?? [];
  check('Only HR / admins can rename a group', renameDenied.status === 403 && renamed.status < 300 && aList.some((r: any) => r.id === gid && r.name === 'Research & writing'), `(${renameDenied.status}/${renamed.status})`);

  console.log('\n— One-to-one');
  const dm1 = await req('/chat/direct', { method: 'POST', token: a.token, body: { userId: b.id } });
  check('An employee starts a one-to-one chat', dm1.status < 300 && dm1.json?.kind === 'DIRECT', `(${dm1.status})`);
  const dm2 = await req('/chat/direct', { method: 'POST', token: b.token, body: { userId: a.id } });
  check('The same pair always gets the same conversation', dm2.json?.id === dm1.json?.id);
  const self = await req('/chat/direct', { method: 'POST', token: a.token, body: { userId: a.id } });
  check('You cannot start a chat with yourself (400)', self.status === 400, `(${self.status})`);
  await req('/chat/messages', { method: 'POST', token: a.token, body: { body: 'Hi Bala, quick question', roomId: dm1.json?.id } });
  const dmRead = await req(`/chat/messages?roomId=${dm1.json?.id}`, { token: c.token });
  check('A third person cannot read the one-to-one (404)', dmRead.status === 404, `(${dmRead.status})`);
  const hrRead = await req(`/chat/messages?roomId=${dm1.json?.id}`, { token: hr.token });
  check('Not even HR can read a private one-to-one (404)', hrRead.status === 404, `(${hrRead.status})`);
  const bList = (await req('/chat/rooms', { token: b.token })).json ?? [];
  const bDm = bList.find((r: any) => r.id === dm1.json?.id);
  check("It shows as Asha's name in Bala's list", bDm?.name === 'Chat Verify Asha' && bDm?.unread >= 1, JSON.stringify(bDm));

  console.log('\n— Company room still works');
  const co = await req('/chat/messages', { method: 'POST', token: c.token, body: { body: 'Company-wide hello' } });
  check('Posting without a room goes to the company room', co.json?.roomId === COMPANY, `(${co.json?.roomId})`);
  const companyList = await req('/chat/messages', { token: a.token });
  check('Everyone can read the company room', companyList.status === 200 && companyList.json?.items?.some((m: any) => m.id === co.json?.id));
  const total = await req('/chat/unread-count', { token: b.token });
  check('The nav badge adds up every room', typeof total.json?.count === 'number' && total.json.count >= 2, `(${JSON.stringify(total.json)})`);

  console.log('\n— Deleting a group');
  const delDenied = await req(`/chat/rooms/${gid}`, { method: 'DELETE', token: a.token });
  const del = await req(`/chat/rooms/${gid}`, { method: 'DELETE', token: hr.token });
  const goneList = (await req('/chat/rooms', { token: a.token })).json ?? [];
  const goneRead = await req(`/chat/messages?roomId=${gid}`, { token: a.token });
  const kept = await prisma.chatMessage.count({ where: { roomId: gid } });
  check('Only HR / admins can delete a group', delDenied.status === 403 && del.status < 300, `(${delDenied.status}/${del.status})`);
  check('A deleted group disappears for its members', !goneList.some((r: any) => r.id === gid) && goneRead.status === 404, `(${goneRead.status})`);
  check('Its messages stay on the server as a record', kept > 0, `(${kept})`);

  // Tidy up the test rooms and the company-room test message.
  await prisma.chatMessage.deleteMany({ where: { id: co.json?.id } });
  await prisma.chatRoom.deleteMany({ where: { id: { in: [gid, dm1.json?.id].filter(Boolean) } } });

  console.log(`\n${passed} passed, ${failed} failed`);
  await prisma.$disconnect();
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
