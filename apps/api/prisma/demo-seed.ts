/**
 * Final demo seed dataset (Spec §11, phase.md Phase 10).
 *
 * Builds a realistic, self-consistent dataset for a go-live walkthrough / staging:
 *   - all 7 roles represented (+ one freelancer = EMPLOYEE + FREELANCE)
 *   - 2 departments, 3 teams (one Team Lead each), ~15 users
 *   - 1 client org + 3 client users (Viewer/Approver) with project access
 *   - 2 projects + 1 work stream
 *   - tasks across EVERY task status, each with an immutable history row
 *   - sample invoices (one partially paid, one paid) with lines + payments
 *   - leave balances + an approved and a pending leave request
 *
 * Idempotent: keyed on stable emails / names / demo invoice numbers, so re-running
 * updates in place rather than duplicating. Run (after `prisma db seed`):
 *   pnpm --filter @rademics/api demo:seed
 *
 * NOTE: run the canonical `prisma db seed` first — this script assumes the §3
 * capability matrix and business-rule settings already exist.
 */
import { PrismaClient, type Role, type TaskStatus } from '@prisma/client';
import { hash as argonHash } from '@node-rs/argon2';

const prisma = new PrismaClient();

const PW = process.env.DEMO_PASSWORD ?? 'Demo1234!';

async function user(
  email: string,
  name: string,
  role: Role,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const passwordHash = await argonHash(PW);
  const u = await prisma.user.upsert({
    where: { email },
    update: { name, role, status: 'ACTIVE', passwordHash, ...extra },
    create: { email, name, role, resourceType: 'INTERNAL', status: 'ACTIVE', passwordHash, ...extra },
    select: { id: true },
  });
  return u.id;
}

async function main(): Promise<void> {
  console.log('Seeding demo dataset (§11)…\n');

  // ── Departments (2) + Teams (3) ──
  const pubDept = await prisma.department.upsert({
    where: { name: 'Publications' },
    update: { vertical: 'PUBLICATIONS' },
    create: { name: 'Publications', vertical: 'PUBLICATIONS' },
  });
  const engDept = await prisma.department.upsert({
    where: { name: 'Engineering' },
    update: { vertical: 'WEB' },
    create: { name: 'Engineering', vertical: 'WEB' },
  });

  // ── Leadership + support users ──
  const saId = await user('admin.demo@rademics.local', 'Aditi (Super Admin)', 'SUPER_ADMIN');
  const hrId = await user('hr.demo@rademics.local', 'Harish (HR)', 'HR', { employmentStatus: 'ACTIVE', joinDate: new Date('2024-01-15') });
  const finId = await user('finance.demo@rademics.local', 'Farah (Finance)', 'FINANCE', { employmentStatus: 'ACTIVE', joinDate: new Date('2024-02-01') });
  const pmId = await user('pm.demo@rademics.local', 'Priya (PM)', 'PM', { departmentId: engDept.id, employmentStatus: 'ACTIVE', joinDate: new Date('2024-03-01') });

  // Team Leads (one per team)
  const tlEditId = await user('tl.editorial@rademics.local', 'Tara (TL Editorial)', 'TEAM_LEAD', { departmentId: pubDept.id, employmentStatus: 'ACTIVE', joinDate: new Date('2024-03-10') });
  const tlFrontId = await user('tl.frontend@rademics.local', 'Vikram (TL Frontend)', 'TEAM_LEAD', { departmentId: engDept.id, employmentStatus: 'ACTIVE', joinDate: new Date('2024-03-12') });
  const tlQaId = await user('tl.qa@rademics.local', 'Nisha (TL QA)', 'TEAM_LEAD', { departmentId: engDept.id, employmentStatus: 'ACTIVE', joinDate: new Date('2024-03-14') });

  const editorial = await prisma.team.upsert({
    where: { departmentId_name: { departmentId: pubDept.id, name: 'Editorial' } },
    update: { teamLeadId: tlEditId },
    create: { name: 'Editorial', departmentId: pubDept.id, teamLeadId: tlEditId },
  });
  const frontend = await prisma.team.upsert({
    where: { departmentId_name: { departmentId: engDept.id, name: 'Frontend' } },
    update: { teamLeadId: tlFrontId },
    create: { name: 'Frontend', departmentId: engDept.id, teamLeadId: tlFrontId },
  });
  const qa = await prisma.team.upsert({
    where: { departmentId_name: { departmentId: engDept.id, name: 'QA' } },
    update: { teamLeadId: tlQaId },
    create: { name: 'QA', departmentId: engDept.id, teamLeadId: tlQaId },
  });

  // Put TLs on their own teams + reporting to PM
  await prisma.user.update({ where: { id: tlEditId }, data: { teamId: editorial.id, reportingManagerId: pmId } });
  await prisma.user.update({ where: { id: tlFrontId }, data: { teamId: frontend.id, reportingManagerId: pmId } });
  await prisma.user.update({ where: { id: tlQaId }, data: { teamId: qa.id, reportingManagerId: pmId } });

  // ── Employees (6) + 1 freelancer ──
  const emp1 = await user('emp.arjun@rademics.local', 'Arjun (Editor)', 'EMPLOYEE', { departmentId: pubDept.id, teamId: editorial.id, reportingManagerId: tlEditId, employmentStatus: 'ACTIVE', joinDate: new Date('2024-05-01') });
  const emp2 = await user('emp.meera@rademics.local', 'Meera (Editor)', 'EMPLOYEE', { departmentId: pubDept.id, teamId: editorial.id, reportingManagerId: tlEditId, employmentStatus: 'ACTIVE', joinDate: new Date('2024-06-01') });
  const emp3 = await user('emp.rohan@rademics.local', 'Rohan (Frontend Dev)', 'EMPLOYEE', { departmentId: engDept.id, teamId: frontend.id, reportingManagerId: tlFrontId, employmentStatus: 'ACTIVE', joinDate: new Date('2024-04-15') });
  const emp4 = await user('emp.sana@rademics.local', 'Sana (Frontend Dev)', 'EMPLOYEE', { departmentId: engDept.id, teamId: frontend.id, reportingManagerId: tlFrontId, employmentStatus: 'ACTIVE', joinDate: new Date('2024-07-01') });
  const emp5 = await user('emp.karthik@rademics.local', 'Karthik (QA)', 'EMPLOYEE', { departmentId: engDept.id, teamId: qa.id, reportingManagerId: tlQaId, employmentStatus: 'ACTIVE', joinDate: new Date('2024-08-01') });
  const emp6 = await user('emp.divya@rademics.local', 'Divya (QA)', 'EMPLOYEE', { departmentId: engDept.id, teamId: qa.id, reportingManagerId: tlQaId, employmentStatus: 'ON_NOTICE', joinDate: new Date('2024-09-01') });
  await user('freelancer.demo@rademics.local', 'Leo (Freelance Designer)', 'EMPLOYEE', { resourceType: 'FREELANCE', departmentId: engDept.id, activeEngagement: true, payPerDeliverable: 5000 });

  // ── Client org (1) + client users (3) ──
  const org = await prisma.clientOrg.upsert({
    where: { name: 'Northwind Publishing' },
    update: { status: 'ACTIVE' },
    create: { name: 'Northwind Publishing', status: 'ACTIVE' },
  });
  const clientApprover = await user('client.owner@northwind.example', 'Nadia (Client Approver)', 'CLIENT', { clientOrgId: org.id });
  const clientViewer1 = await user('client.viewer1@northwind.example', 'Omar (Client Viewer)', 'CLIENT', { clientOrgId: org.id });
  const clientViewer2 = await user('client.viewer2@northwind.example', 'Ivy (Client Viewer)', 'CLIENT', { clientOrgId: org.id });

  // ── Projects (2) + 1 Work Stream ──
  async function findOrCreateProject(name: string, data: Record<string, unknown>) {
    const existing = await prisma.project.findFirst({ where: { name } });
    if (existing) {
      return prisma.project.update({ where: { id: existing.id }, data });
    }
    return prisma.project.create({ data: { name, ...data } as never });
  }

  const projA = await findOrCreateProject('Journal Platform Revamp', {
    type: 'PROJECT', status: 'ACTIVE', vertical: 'WEB', pmId, clientId: clientApprover,
    clientOrgId: org.id, budgetAmount: 800000, startDate: new Date('2026-05-01'), endDate: new Date('2026-10-31'),
    description: 'Rebuild the online journal submission + review platform.',
  });
  const projB = await findOrCreateProject('Annual Report 2026', {
    type: 'PROJECT', status: 'ACTIVE', vertical: 'PUBLICATIONS', pmId, clientId: clientApprover,
    clientOrgId: org.id, budgetAmount: 250000, startDate: new Date('2026-06-01'), endDate: new Date('2026-09-30'),
    description: 'Design + typeset the 2026 annual report.',
  });
  const stream = await findOrCreateProject('Ongoing Support Stream', {
    type: 'STREAM', status: 'ACTIVE', vertical: 'SUPPORT', pmId, clientOrgId: org.id,
    cadence: 'WEEKLY', startDate: new Date('2026-05-01'), description: 'Continuous maintenance + support requests.',
  });

  // Client project access (§5.5): approver + 2 viewers on Project A
  for (const [uid, level] of [[clientApprover, 'APPROVER'], [clientViewer1, 'VIEWER'], [clientViewer2, 'VIEWER']] as const) {
    await prisma.clientProjectAccess.upsert({
      where: { projectId_clientUserId: { projectId: projA.id, clientUserId: uid } },
      update: { level },
      create: { projectId: projA.id, clientUserId: uid, level },
    });
  }

  // ── Module + tasks across EVERY status ──
  const moduleA = await prisma.module.upsert({
    where: { projectId_name: { projectId: projA.id, name: 'Submission Flow' } },
    update: {},
    create: { projectId: projA.id, name: 'Submission Flow', position: 0 },
  });

  const allStatuses: TaskStatus[] = [
    'DRAFT', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'SUBMITTED_FOR_REVIEW',
    'CLIENT_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED', 'CANCELLED',
  ];
  const assignees = [emp3, emp4, emp3, emp4, emp3, emp4, emp3, emp4, emp3, emp4];

  const existingTaskCount = await prisma.task.count({ where: { projectId: projA.id, title: { startsWith: 'DEMO ·' } } });
  if (existingTaskCount === 0) {
    for (let i = 0; i < allStatuses.length; i++) {
      const status = allStatuses[i];
      const task = await prisma.task.create({
        data: {
          projectId: projA.id,
          moduleId: moduleA.id,
          title: `DEMO · ${status.replace(/_/g, ' ')} task`,
          description: `Seed task demonstrating the ${status} state.`,
          assigneeId: status === 'DRAFT' ? null : assignees[i],
          priority: i % 3 === 0 ? 'HIGH' : i % 3 === 1 ? 'MEDIUM' : 'LOW',
          estimatedHours: 4 + i,
          actualHours: ['COMPLETED', 'INVOICED', 'CLOSED'].includes(status) ? 4 + i : null,
          clientFacing: ['CLIENT_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED'].includes(status),
          status,
          createdById: pmId,
          deadline: new Date(Date.now() + (i + 1) * 3 * 24 * 60 * 60 * 1000),
        },
        select: { id: true },
      });
      // Immutable history row (§6): creation into its seeded status.
      await prisma.taskStatusHistory.create({
        data: {
          taskId: task.id, fromStatus: null, toStatus: status, action: 'DEMO_SEED',
          actorId: pmId, actorEmail: 'pm.demo@rademics.local', comment: 'Seeded for demo walkthrough.',
        },
      });
    }
    console.log(`  Seeded ${allStatuses.length} tasks (one per status) in "${projA.name}".`);
  } else {
    console.log(`  Tasks already present in "${projA.name}" — skipped.`);
  }

  // A couple of tasks in Project B + the stream so they aren't empty
  async function ensureTask(projectId: string, title: string, status: TaskStatus, assigneeId: string | null) {
    const existing = await prisma.task.findFirst({ where: { projectId, title } });
    if (existing) return;
    const t = await prisma.task.create({
      data: { projectId, title, status, assigneeId, createdById: pmId, estimatedHours: 6, priority: 'MEDIUM' },
      select: { id: true },
    });
    await prisma.taskStatusHistory.create({
      data: { taskId: t.id, fromStatus: null, toStatus: status, action: 'DEMO_SEED', actorId: pmId },
    });
  }
  await ensureTask(projB.id, 'DEMO · Cover design', 'IN_PROGRESS', emp1);
  await ensureTask(projB.id, 'DEMO · Typeset chapter 1', 'ASSIGNED', emp2);
  await ensureTask(stream.id, 'DEMO · Weekly maintenance', 'IN_PROGRESS', emp5);

  // ── Invoices (2): one partially paid, one paid ──
  async function ensureInvoice(
    number: string,
    status: 'PARTIALLY_PAID' | 'PAID',
    lines: { description: string; quantity: number; rate: number; gstPercent: number }[],
    payFraction: number,
  ) {
    const existing = await prisma.invoice.findUnique({ where: { number } });
    if (existing) return existing;
    let subtotal = 0;
    let gstAmount = 0;
    const lineData = lines.map((l, idx) => {
      const lineSubtotal = l.quantity * l.rate;
      const lineGst = (lineSubtotal * l.gstPercent) / 100;
      subtotal += lineSubtotal;
      gstAmount += lineGst;
      return {
        position: idx, description: l.description, quantity: l.quantity, rate: l.rate,
        gstPercent: l.gstPercent, lineSubtotal, lineGst, lineTotal: lineSubtotal + lineGst,
      };
    });
    const total = subtotal + gstAmount;
    const amountPaid = Math.round(total * payFraction * 100) / 100;
    const inv = await prisma.invoice.create({
      data: {
        number, status, clientOrgId: org.id, projectId: projA.id,
        issueDate: new Date('2026-06-15'), dueDate: new Date('2026-06-30'),
        subtotal, gstAmount, total, amountPaid, createdById: finId,
        notes: 'Demo invoice for walkthrough.',
        lines: { create: lineData },
      },
      select: { id: true, number: true },
    });
    if (amountPaid > 0) {
      await prisma.payment.create({
        data: {
          invoiceId: inv.id, paidAt: new Date('2026-06-20'), mode: 'Bank Transfer',
          reference: `TXN-${number}`, amount: amountPaid, createdById: finId,
        },
      });
    }
    return inv;
  }
  await ensureInvoice('RAD-DEMO-0001', 'PARTIALLY_PAID', [
    { description: 'Platform milestone 1', quantity: 1, rate: 200000, gstPercent: 18 },
  ], 0.5);
  await ensureInvoice('RAD-DEMO-0002', 'PAID', [
    { description: 'Design sprint', quantity: 40, rate: 1500, gstPercent: 18 },
  ], 1);
  console.log('  Seeded 2 invoices (partially paid + paid).');

  // ── Leave: balances + one approved + one pending request ──
  const year = 2026;
  for (const [type, accrued, used] of [['CASUAL', 6, 1], ['SICK', 3, 0], ['EARNED', 7.5, 2]] as const) {
    await prisma.leaveBalance.upsert({
      where: { userId_type_year: { userId: emp3, type, year } },
      update: { accruedDays: accrued, usedDays: used },
      create: { userId: emp3, type, year, accruedDays: accrued, usedDays: used },
    });
  }
  const hasApproved = await prisma.leaveRequest.findFirst({ where: { userId: emp3, reason: { startsWith: 'DEMO' } } });
  if (!hasApproved) {
    await prisma.leaveRequest.create({
      data: {
        userId: emp3, type: 'CASUAL', half: 'FULL',
        fromDate: new Date('2026-06-10'), toDate: new Date('2026-06-10'), reason: 'DEMO family function',
        totalDays: 1, paidDays: 1, unpaidDays: 0, status: 'APPROVED',
        currentLevel: 'TEAM_LEAD', reviewerId: tlFrontId, decidedAt: new Date('2026-06-08'),
        decisionComment: 'Approved.',
      },
    });
    await prisma.leaveRequest.create({
      data: {
        userId: emp4, type: 'SICK', half: 'FIRST_HALF',
        fromDate: new Date('2026-07-20'), toDate: new Date('2026-07-20'), reason: 'DEMO medical appointment',
        totalDays: 0.5, paidDays: 0.5, unpaidDays: 0, status: 'PENDING',
        currentLevel: 'TEAM_LEAD', currentApproverId: tlFrontId,
        escalationDueAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      },
    });
    console.log('  Seeded leave balances + 1 approved + 1 pending request.');
  } else {
    console.log('  Leave requests already present — skipped.');
  }

  const userCount = await prisma.user.count();
  console.log(`\n✅ Demo seed complete. Total users in DB: ${userCount}.`);
  console.log(`   Demo password for every seeded account: ${PW}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
