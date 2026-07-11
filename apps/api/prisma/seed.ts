/**
 * Seed script v1 (Spec §11, phase.md Phase 1).
 *
 * Seeds:
 *  - The Role & Permission Matrix (§3) into role_capabilities (editable later by SA).
 *  - Business-rule defaults (§4) into settings.
 *  - A Super Admin so the system is usable on first run.
 *
 * Idempotent: safe to re-run.
 */
import { PrismaClient, type Grant as PrismaGrant, type Role as PrismaRole } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';
import { PERMISSION_MATRIX } from '@rademics/permissions';
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';

const prisma = new PrismaClient();

async function seedCapabilities(): Promise<number> {
  let count = 0;
  for (const [capabilityKey, grants] of Object.entries(PERMISSION_MATRIX)) {
    for (const [role, grant] of Object.entries(grants)) {
      await prisma.roleCapability.upsert({
        where: { role_capabilityKey: { role: role as PrismaRole, capabilityKey } },
        update: { grant: grant as PrismaGrant },
        create: { role: role as PrismaRole, capabilityKey, grant: grant as PrismaGrant },
      });
      count++;
    }
  }
  return count;
}

async function seedSettings(): Promise<void> {
  await prisma.setting.upsert({
    where: { key: 'business_rules' },
    update: { value: DEFAULT_BUSINESS_RULES as object },
    create: { key: 'business_rules', value: DEFAULT_BUSINESS_RULES as object },
  });
}

async function seedSuperAdmin(): Promise<void> {
  const email = (process.env.SEED_SUPERADMIN_EMAIL ?? 'admin@rademics.local').toLowerCase();
  const password = process.env.SEED_SUPERADMIN_PASSWORD ?? 'ChangeMe123!';
  const passwordHash = await argonHash(password);

  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: 'Super Admin',
      role: 'SUPER_ADMIN',
      resourceType: 'INTERNAL',
      status: 'ACTIVE',
      passwordHash,
    },
  });

  // eslint-disable-next-line no-console
  console.log(`  Super Admin: ${email} / ${password}  (change after first login)`);
}

async function main(): Promise<void> {
  console.log('Seeding Rademics ERP…');
  const caps = await seedCapabilities();
  console.log(`  Seeded ${caps} role-capability grants (§3 matrix).`);
  await seedSettings();
  console.log('  Seeded business-rule defaults (§4).');
  await seedSuperAdmin();
  console.log('Seed complete.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
