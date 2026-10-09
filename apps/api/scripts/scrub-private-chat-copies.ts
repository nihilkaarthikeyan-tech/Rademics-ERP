/**
 * One-off (2026-10-09): remove readable copies of private chat text left from
 * before chat encryption at rest. Group and one-to-one message text used to be
 * copied, in plain text, into:
 *   - audit log entries for edited / deleted messages (before / after "body"), and
 *   - @mention notifications (the notification body quoted the message).
 * The company room is readable by all staff, so its entries are left as they are.
 * Safe to run more than once.
 *
 * Run: pnpm --filter @rademics/api chat:scrub-private-copies
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();
const PLACEHOLDER = '[private conversation]';
const MENTION_BODY = 'Open the chat to read the message.';

async function privateMessageIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.chatMessage.findMany({
    where: { id: { in: ids }, room: { kind: { not: 'COMPANY' } } },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

function scrub(json: Prisma.JsonValue | null): Prisma.InputJsonValue | typeof Prisma.DbNull {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return (json ?? Prisma.DbNull) as never;
  const obj = { ...(json as Record<string, unknown>) };
  if ('body' in obj) obj.body = PLACEHOLDER;
  return obj as Prisma.InputJsonValue;
}

async function main(): Promise<void> {
  const audits = await prisma.auditLog.findMany({
    where: { action: { in: ['CHAT_MESSAGE_EDITED', 'CHAT_MESSAGE_DELETED'] }, entityType: 'ChatMessage' },
    select: { id: true, entityId: true, before: true, after: true },
  });
  const privAudit = await privateMessageIds(audits.map((a) => a.entityId).filter((x): x is string => Boolean(x)));
  let auditDone = 0;
  for (const a of audits) {
    if (!a.entityId || !privAudit.has(a.entityId)) continue;
    const b = a.before as Record<string, unknown> | null;
    const f = a.after as Record<string, unknown> | null;
    if ((b?.body ?? PLACEHOLDER) === PLACEHOLDER && (f?.body ?? PLACEHOLDER) === PLACEHOLDER) continue;
    await prisma.auditLog.update({ where: { id: a.id }, data: { before: scrub(a.before), after: scrub(a.after) } });
    auditDone++;
  }

  const mentions = await prisma.notification.findMany({
    where: { type: 'CHAT_MENTION', entityType: 'ChatMessage' },
    select: { id: true, entityId: true, body: true },
  });
  const privMention = await privateMessageIds(mentions.map((m) => m.entityId).filter((x): x is string => Boolean(x)));
  let mentionDone = 0;
  for (const m of mentions) {
    if (!m.entityId || !privMention.has(m.entityId) || m.body === MENTION_BODY) continue;
    await prisma.notification.update({ where: { id: m.id }, data: { body: MENTION_BODY } });
    mentionDone++;
  }

  console.log(`Scrubbed ${auditDone} audit entries and ${mentionDone} mention notifications.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
