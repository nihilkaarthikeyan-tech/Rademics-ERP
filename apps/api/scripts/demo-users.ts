/**
 * Dev-only helper: create demo accounts so every app is loginable for a walkthrough.
 * Idempotent. Not part of the canonical seed. Run: pnpm --filter @rademics/api seed:demo
 */
import { PrismaClient } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';

const prisma = new PrismaClient();

const DEMO = [
  { email: 'client.demo@rademics.local', name: 'Demo Client', role: 'CLIENT', password: 'ClientDemo123!' },
  { email: 'hr.demo@rademics.local', name: 'Demo HR', role: 'HR', password: 'HrDemo1234!' },
  { email: 'employee.demo@rademics.local', name: 'Demo Employee', role: 'EMPLOYEE', password: 'EmpDemo1234!' },
] as const;

async function main(): Promise<void> {
  for (const u of DEMO) {
    const passwordHash = await argonHash(u.password);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { status: 'ACTIVE', passwordHash },
      create: {
        email: u.email,
        name: u.name,
        role: u.role,
        resourceType: 'INTERNAL',
        status: 'ACTIVE',
        passwordHash,
      },
    });
    // eslint-disable-next-line no-console
    console.log(`  ${u.role.padEnd(12)} ${u.email} / ${u.password}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
