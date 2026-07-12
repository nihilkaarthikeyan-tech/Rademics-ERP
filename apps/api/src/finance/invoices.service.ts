import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SettingsService } from '../settings/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailProducer } from '../queue/email.producer';
import { toFinanceConfig, type FinanceConfig } from './finance-config';
import type {
  CancelInvoiceDto,
  CreateInvoiceDto,
  CreatePaymentDto,
  ReversePaymentDto,
} from './dto';
import type { AuthUser } from '../auth/auth-user';

interface Meta {
  ip?: string | null;
  userAgent?: string | null;
}

const money = (n: number) => Math.round(n * 100) / 100;
const num = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);

const INVOICE_INCLUDE = {
  lines: { orderBy: { position: 'asc' } },
  payments: { orderBy: { paidAt: 'asc' } },
  clientOrg: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, vertical: true } },
} satisfies Prisma.InvoiceInclude;

/**
 * Invoices & payments (Spec §5.8). Draft → Sent → Partially Paid → Paid with an
 * auto-Overdue sweep; numbers are auto-assigned and never reused (§24); content edits
 * after Sent go through cancel-and-reissue; payments are partial-capable and reversed
 * only by compensating entries (§25).
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailProducer,
  ) {}

  async getConfig(): Promise<FinanceConfig> {
    const rules = { ...DEFAULT_BUSINESS_RULES, ...(await this.settings.getBusinessRules()) } as Record<
      string,
      unknown
    >;
    return toFinanceConfig(rules);
  }

  // ── Number assignment (Spec §4): RAD-{YYYY}-{SEQ4}, burned on cancel (§24) ──
  private async nextNumber(year: number, tx: Prisma.TransactionClient): Promise<string> {
    const seq = await tx.invoiceSequence.upsert({
      where: { year },
      update: { lastSeq: { increment: 1 } },
      create: { year, lastSeq: 1 },
    });
    return `RAD-${year}-${String(seq.lastSeq).padStart(4, '0')}`;
  }

  private computeLines(lines: CreateInvoiceDto['lines'], defaultGst: number) {
    let subtotal = 0;
    let gstAmount = 0;
    const rows = lines.map((l, i) => {
      const gstPercent = l.gstPercent ?? defaultGst;
      const lineSubtotal = money(l.quantity * l.rate);
      const lineGst = money((lineSubtotal * gstPercent) / 100);
      subtotal += lineSubtotal;
      gstAmount += lineGst;
      return {
        position: i,
        description: l.description.trim(),
        quantity: l.quantity,
        rate: l.rate,
        gstPercent,
        lineSubtotal,
        lineGst,
        lineTotal: money(lineSubtotal + lineGst),
      };
    });
    return { rows, subtotal: money(subtotal), gstAmount: money(gstAmount), total: money(subtotal + gstAmount) };
  }

  // ── Create a DRAFT invoice (Spec §5.8, §24) ──
  async create(dto: CreateInvoiceDto, actor: AuthUser, meta: Meta) {
    const issue = new Date(dto.issueDate);
    const config = await this.getConfig();
    const due = dto.dueDate
      ? new Date(dto.dueDate)
      : new Date(issue.getTime() + config.paymentTermsDays * 86_400_000);
    if (due < issue) throw new BadRequestException('Due date must be on or after the issue date');

    const { rows, subtotal, gstAmount, total } = this.computeLines(dto.lines, config.defaultGstPercent);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const number = await this.nextNumber(issue.getUTCFullYear(), tx);
      return tx.invoice.create({
        data: {
          number,
          status: 'DRAFT',
          clientOrgId: dto.clientOrgId ?? null,
          projectId: dto.projectId ?? null,
          issueDate: issue,
          dueDate: due,
          subtotal,
          gstAmount,
          total,
          notes: dto.notes ?? null,
          footerText: config.invoiceFooterText,
          createdById: actor.id,
          lines: { create: rows },
        },
        include: INVOICE_INCLUDE,
      });
    });

    await this.audit.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: 'INVOICE_CREATED',
      entityType: 'Invoice',
      entityId: invoice.id,
      after: { number: invoice.number, total },
      ...meta,
    });
    return this.decorate(invoice);
  }

  // ── Draft a bill from a project's completed tasks (Spec §5.8 ready-to-invoice) ──
  async createFromProject(projectId: string, actor: AuthUser, meta: Meta) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, clientOrgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    const tasks = await this.prisma.task.findMany({
      where: { projectId, status: 'COMPLETED', parentTaskId: null },
      select: { title: true, actualHours: true, estimatedHours: true },
    });
    if (tasks.length === 0) throw new BadRequestException('No completed tasks to invoice');

    const lines = tasks.map((t) => ({
      description: t.title,
      quantity: num(t.actualHours) || num(t.estimatedHours) || 1,
      rate: 0, // Finance fills billing rates before sending
    }));
    return this.create(
      { projectId, clientOrgId: project.clientOrgId ?? undefined, issueDate: new Date().toISOString(), lines },
      actor,
      meta,
    );
  }

  // ── Edit a DRAFT (content edits after Sent require cancel-and-reissue, §24) ──
  async updateDraft(id: string, dto: CreateInvoiceDto, actor: AuthUser, meta: Meta) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, select: { status: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status !== 'DRAFT') {
      throw new ConflictException('Only a draft can be edited; sent invoices require cancel-and-reissue');
    }
    const config = await this.getConfig();
    const issue = new Date(dto.issueDate);
    const due = dto.dueDate ? new Date(dto.dueDate) : new Date(issue.getTime() + config.paymentTermsDays * 86_400_000);
    if (due < issue) throw new BadRequestException('Due date must be on or after the issue date');
    const { rows, subtotal, gstAmount, total } = this.computeLines(dto.lines, config.defaultGstPercent);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.invoiceLine.deleteMany({ where: { invoiceId: id } });
      return tx.invoice.update({
        where: { id },
        data: {
          clientOrgId: dto.clientOrgId ?? null,
          projectId: dto.projectId ?? null,
          issueDate: issue,
          dueDate: due,
          subtotal,
          gstAmount,
          total,
          notes: dto.notes ?? null,
          lines: { create: rows },
        },
        include: INVOICE_INCLUDE,
      });
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, action: 'INVOICE_UPDATED',
      entityType: 'Invoice', entityId: id, after: { total }, ...meta,
    });
    return this.decorate(updated);
  }

  // ── Send: DRAFT → SENT, email client contacts, appears in portal (Spec §5.8) ──
  async send(id: string, actor: AuthUser, meta: Meta) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status !== 'DRAFT') throw new ConflictException('Only a draft invoice can be sent');

    const updated = await this.prisma.invoice.update({
      where: { id }, data: { status: 'SENT' }, include: INVOICE_INCLUDE,
    });
    await this.emailClientContacts(inv.clientOrgId, `Invoice ${inv.number} from ${(await this.getConfig()).companyName}`,
      `<p>Invoice <strong>${inv.number}</strong> for ₹${num(inv.total).toFixed(2)} is now available in your portal.</p>`);
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, action: 'INVOICE_SENT',
      entityType: 'Invoice', entityId: id, before: { status: 'DRAFT' }, after: { status: 'SENT' }, ...meta,
    });
    return this.decorate(updated);
  }

  // ── Cancel (burns the number, §24) ──
  async cancel(id: string, dto: CancelInvoiceDto, actor: AuthUser, meta: Meta) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, select: { status: true, number: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === 'PAID') throw new ConflictException('A paid invoice cannot be cancelled');
    const updated = await this.prisma.invoice.update({
      where: { id }, data: { status: 'CANCELLED', cancelledReason: dto.reason.trim() }, include: INVOICE_INCLUDE,
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, action: 'INVOICE_CANCELLED',
      entityType: 'Invoice', entityId: id, after: { reason: dto.reason }, ...meta,
    });
    return this.decorate(updated);
  }

  // ── Cancel-and-reissue: content edit after Sent (Spec §24) ──
  async reissue(id: string, dto: CancelInvoiceDto, actor: AuthUser, meta: Meta) {
    const source = await this.prisma.invoice.findUnique({ where: { id }, include: { lines: { orderBy: { position: 'asc' } } } });
    if (!source) throw new NotFoundException('Invoice not found');
    if (source.status === 'PAID' || source.status === 'CANCELLED') {
      throw new ConflictException('Only an active invoice can be reissued');
    }
    const config = await this.getConfig();

    const fresh = await this.prisma.$transaction(async (tx) => {
      await tx.invoice.update({ where: { id }, data: { status: 'CANCELLED', cancelledReason: `Reissued: ${dto.reason.trim()}` } });
      const number = await this.nextNumber(source.issueDate.getUTCFullYear(), tx);
      return tx.invoice.create({
        data: {
          number,
          status: 'DRAFT',
          clientOrgId: source.clientOrgId,
          projectId: source.projectId,
          issueDate: source.issueDate,
          dueDate: source.dueDate,
          subtotal: source.subtotal,
          gstAmount: source.gstAmount,
          total: source.total,
          notes: source.notes,
          footerText: config.invoiceFooterText,
          reissuedFromId: source.id,
          createdById: actor.id,
          lines: {
            create: source.lines.map((l) => ({
              position: l.position, description: l.description, quantity: l.quantity,
              rate: l.rate, gstPercent: l.gstPercent, lineSubtotal: l.lineSubtotal,
              lineGst: l.lineGst, lineTotal: l.lineTotal,
            })),
          },
        },
        include: INVOICE_INCLUDE,
      });
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, action: 'INVOICE_REISSUED',
      entityType: 'Invoice', entityId: fresh.id, before: { from: source.number }, after: { to: fresh.number }, ...meta,
    });
    return this.decorate(fresh);
  }

  // ── Payments (Spec §5.8, §24: 0 < amount ≤ balance) ──
  async recordPayment(invoiceId: string, dto: CreatePaymentDto, actor: AuthUser, meta: Meta) {
    const inv = await this.prisma.invoice.findUnique({ where: { id: invoiceId }, select: { status: true, total: true, amountPaid: true, number: true, projectId: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === 'DRAFT') throw new BadRequestException('Send the invoice before recording payments');
    if (inv.status === 'CANCELLED') throw new BadRequestException('Cannot pay a cancelled invoice');

    const balance = money(num(inv.total) - num(inv.amountPaid));
    if (dto.amount > balance) {
      throw new BadRequestException(`Payment exceeds balance; remaining is ₹${balance.toFixed(2)}`);
    }

    const paidAt = dto.paidAt ? new Date(dto.paidAt) : new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: { invoiceId, paidAt, mode: dto.mode, reference: dto.reference ?? null, amount: dto.amount, note: dto.note ?? null, createdById: actor.id },
      });
      const newPaid = money(num(inv.amountPaid) + dto.amount);
      return tx.invoice.update({
        where: { id: invoiceId },
        data: { amountPaid: newPaid, status: this.statusFor(inv.status, num(inv.total), newPaid) },
        include: INVOICE_INCLUDE,
      });
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, action: 'PAYMENT_RECORDED',
      entityType: 'Invoice', entityId: invoiceId, after: { amount: dto.amount, mode: dto.mode }, ...meta,
    });
    if (updated.status === 'PAID' && updated.project?.id) {
      await this.notifyPm(updated.project.id, `Invoice ${inv.number} is fully paid`);
    }
    return this.decorate(updated);
  }

  // ── Reverse a payment: compensating negative entry only (Spec §25) ──
  async reversePayment(paymentId: string, dto: ReversePaymentDto, actor: AuthUser, meta: Meta) {
    const pay = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { invoice: { select: { id: true, status: true, total: true, amountPaid: true } } } });
    if (!pay) throw new NotFoundException('Payment not found');
    if (pay.isReversal) throw new BadRequestException('Cannot reverse a reversal entry');

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: { invoiceId: pay.invoiceId, paidAt: new Date(), mode: pay.mode, reference: pay.reference, amount: money(-num(pay.amount)), note: `Reversal: ${dto.reason.trim()}`, isReversal: true, createdById: actor.id },
      });
      const newPaid = money(num(pay.invoice.amountPaid) - num(pay.amount));
      return tx.invoice.update({
        where: { id: pay.invoiceId },
        data: { amountPaid: newPaid, status: this.statusFor(pay.invoice.status, num(pay.invoice.total), newPaid) },
        include: INVOICE_INCLUDE,
      });
    });
    await this.audit.record({
      actorId: actor.id, actorEmail: actor.email, action: 'PAYMENT_REVERSED',
      entityType: 'Payment', entityId: paymentId, after: { reason: dto.reason }, ...meta,
    });
    return this.decorate(updated);
  }

  /** Daily sweep (Spec §5.8): past-due unpaid SENT/PARTIALLY_PAID invoices → OVERDUE. */
  async sweepOverdue(): Promise<{ flagged: number }> {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const candidates = await this.prisma.invoice.findMany({
      where: { status: { in: ['SENT', 'PARTIALLY_PAID'] }, dueDate: { lt: today } },
      select: { id: true, total: true, amountPaid: true },
    });
    let flagged = 0;
    for (const inv of candidates) {
      if (num(inv.amountPaid) < num(inv.total)) {
        await this.prisma.invoice.update({ where: { id: inv.id }, data: { status: 'OVERDUE' } });
        flagged++;
      }
    }
    return { flagged };
  }

  /** Recompute status after a balance change, preserving Overdue when still past due. */
  private statusFor(current: string, total: number, paid: number): 'PAID' | 'PARTIALLY_PAID' | 'SENT' | 'OVERDUE' {
    if (paid >= total) return 'PAID';
    if (current === 'OVERDUE') return 'OVERDUE';
    if (paid > 0) return 'PARTIALLY_PAID';
    return 'SENT';
  }

  // ── Reads ──
  async get(id: string) {
    const inv = await this.prisma.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    if (!inv) throw new NotFoundException('Invoice not found');
    return this.decorate(inv);
  }

  async list(status?: string) {
    const invoices = await this.prisma.invoice.findMany({
      where: status ? { status: status as never } : undefined,
      orderBy: { createdAt: 'desc' },
      include: INVOICE_INCLUDE,
    });
    return invoices.map((i) => this.decorate(i));
  }

  /** Outstanding dues per client with 0–30 / 31–60 / 61–90 / 90+ aging (Spec §17.5). */
  async dues() {
    const open = await this.prisma.invoice.findMany({
      where: { status: { in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } },
      include: { clientOrg: { select: { id: true, name: true } } },
    });
    const now = Date.now();
    const byClient = new Map<string, { clientOrgId: string | null; clientName: string; total: number; b0: number; b30: number; b60: number; b90: number; oldest: string | null; oldestDays: number }>();
    for (const inv of open) {
      const balance = money(num(inv.total) - num(inv.amountPaid));
      if (balance <= 0) continue;
      const key = inv.clientOrgId ?? 'none';
      const days = Math.floor((now - inv.dueDate.getTime()) / 86_400_000);
      const row = byClient.get(key) ?? { clientOrgId: inv.clientOrgId, clientName: inv.clientOrg?.name ?? 'Unassigned', total: 0, b0: 0, b30: 0, b60: 0, b90: 0, oldest: null, oldestDays: -Infinity };
      row.total = money(row.total + balance);
      if (days <= 30) row.b0 = money(row.b0 + balance);
      else if (days <= 60) row.b30 = money(row.b30 + balance);
      else if (days <= 90) row.b60 = money(row.b60 + balance);
      else row.b90 = money(row.b90 + balance);
      if (days > row.oldestDays) { row.oldestDays = days; row.oldest = inv.number; }
      byClient.set(key, row);
    }
    return [...byClient.values()].sort((a, b) => b.total - a.total);
  }

  private decorate<T extends { total: unknown; amountPaid: unknown; dueDate: Date; status: string }>(inv: T) {
    const balance = money(num(inv.total as never) - num(inv.amountPaid as never));
    const daysOverdue = inv.status === 'OVERDUE' ? Math.max(0, Math.floor((Date.now() - inv.dueDate.getTime()) / 86_400_000)) : 0;
    return { ...inv, balance, daysOverdue };
  }

  private async emailClientContacts(clientOrgId: string | null, subject: string, html: string): Promise<void> {
    if (!clientOrgId) return;
    const users = await this.prisma.user.findMany({ where: { clientOrgId, status: 'ACTIVE' }, select: { email: true } });
    await Promise.all(users.map((u) => this.email.enqueue({ to: u.email, subject, html, text: subject })));
  }

  private async notifyPm(projectId: string, title: string): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { pmId: true } });
    await this.notifications.notify({ userId: project?.pmId ?? '', type: 'INVOICE_PAID', eventGroup: 'finance', title, entityType: 'Project', entityId: projectId });
  }
}
