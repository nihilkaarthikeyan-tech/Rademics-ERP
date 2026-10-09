/**
 * One-off (2026-10-09): encrypt chat message text that was stored before
 * encryption at rest was switched on. Safe to run more than once — rows that
 * are already encrypted ("v1." prefix) and empty bodies are skipped.
 *
 * Uses the same AES-256-GCM scheme and key derivation as EncryptionService.
 * Run: pnpm --filter @rademics/api chat:encrypt-existing
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const material = process.env.FIELD_ENCRYPTION_KEY;
if (!material) {
  console.error('FIELD_ENCRYPTION_KEY is not set');
  process.exit(1);
}
const key = createHash('sha256').update(material).digest();

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${data.toString('base64')}`;
}

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const messages = await prisma.chatMessage.findMany({
    where: { NOT: { body: '' } },
    select: { id: true, body: true },
  });
  let done = 0;
  for (const m of messages) {
    if (m.body.startsWith('v1.')) continue;
    await prisma.chatMessage.update({ where: { id: m.id }, data: { body: encrypt(m.body) } });
    done++;
  }

  const scheduled = await prisma.chatScheduledMessage.findMany({ select: { id: true, body: true } });
  let doneScheduled = 0;
  for (const s of scheduled) {
    if (!s.body || s.body.startsWith('v1.')) continue;
    await prisma.chatScheduledMessage.update({ where: { id: s.id }, data: { body: encrypt(s.body) } });
    doneScheduled++;
  }

  console.log(`Encrypted ${done} of ${messages.length} messages and ${doneScheduled} scheduled messages.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
