import { Injectable } from '@nestjs/common';
import { DEFAULT_BUSINESS_RULES } from '@rademics/types';
import type { BusinessVertical, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { toFinanceConfig } from './finance-config';
import type { FinanceRangeQuery } from './dto';

const money = (n: number) => Math.round(n * 100) / 100;
const num = (d: Prisma.Decimal | number | null | undefined) => Number(d ?? 0);

interface PnlRow {
  vertical: string;
  invoicedRevenue: number;
  collected: number;
  expensesByCategory: Record<string, number>;
  expensesTotal: number;
  estimatedLaborCost: number;
  net: number;
}

/**
 * P&L per business vertical (Spec §5.8): invoiced revenue − expenses, with an
 * estimated labour cost = actual hours × per-role hourly cost rate (§23). Grouped by
 * the project's vertical; filterable by date range.
 */
@Injectable()
export class PnlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async report(query: FinanceRangeQuery) {
    const rules = { ...DEFAULT_BUSINESS_RULES, ...(await this.settings.getBusinessRules()) } as Record<string, unknown>;
    const config = toFinanceConfig(rules);
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    const inRange = (field: string) =>
      from || to ? { [field]: { gte: from, lte: to } } : {};

    const rows = new Map<string, PnlRow>();
    const row = (v: string): PnlRow => {
      let r = rows.get(v);
      if (!r) { r = { vertical: v, invoicedRevenue: 0, collected: 0, expensesByCategory: {}, expensesTotal: 0, estimatedLaborCost: 0, net: 0 }; rows.set(v, r); }
      return r;
    };
    const vLabel = (v: BusinessVertical | null) => v ?? 'UNCLASSIFIED';

    // Invoiced revenue (ex-GST subtotal) by vertical — only issued invoices count
    // (drafts and cancelled are excluded).
    const invoices = await this.prisma.invoice.findMany({
      where: { status: { in: ['SENT', 'PARTIALLY_PAID', 'PAID', 'OVERDUE'] }, ...(inRange('issueDate') as Prisma.InvoiceWhereInput) },
      select: { subtotal: true, amountPaid: true, project: { select: { vertical: true } } },
    });
    for (const inv of invoices) {
      const r = row(vLabel(inv.project?.vertical ?? null));
      r.invoicedRevenue = money(r.invoicedRevenue + num(inv.subtotal));
      r.collected = money(r.collected + num(inv.amountPaid));
    }

    // Expenses by vertical + category.
    const expenses = await this.prisma.expense.findMany({
      where: inRange('spentAt') as Prisma.ExpenseWhereInput,
      select: { amount: true, category: true, project: { select: { vertical: true } } },
    });
    for (const e of expenses) {
      const r = row(vLabel(e.project?.vertical ?? null));
      const amt = num(e.amount);
      r.expensesByCategory[e.category] = money((r.expensesByCategory[e.category] ?? 0) + amt);
      r.expensesTotal = money(r.expensesTotal + amt);
    }

    // Estimated labour cost = actual hours × per-role hourly cost rate.
    const tasks = await this.prisma.task.findMany({
      where: { actualHours: { not: null }, ...(inRange('updatedAt') as Prisma.TaskWhereInput) },
      select: { actualHours: true, project: { select: { vertical: true } }, assignee: { select: { role: true } } },
    });
    for (const t of tasks) {
      const rate = config.hourlyCostRates[t.assignee?.role ?? ''] ?? 0;
      const r = row(vLabel(t.project?.vertical ?? null));
      r.estimatedLaborCost = money(r.estimatedLaborCost + num(t.actualHours) * rate);
    }

    for (const r of rows.values()) {
      r.net = money(r.invoicedRevenue - r.expensesTotal - r.estimatedLaborCost);
    }
    return {
      from: query.from ?? null,
      to: query.to ?? null,
      rows: [...rows.values()].sort((a, b) => b.net - a.net),
    };
  }
}
