import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ExpensesService } from './expenses.service';
import { PnlService } from './pnl.service';
import { PayrollService } from './payroll.service';
import {
  CreateExpenseDto,
  FinanceRangeQuery,
  PayrollMonthDto,
  UnlockMonthDto,
} from './dto';
import { RequireCapability, RequireScopedCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

/** Expenses, P&L, and the payroll export (Spec §5.8, §21). */
@Controller('finance')
export class FinanceController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly pnl: PnlService,
    private readonly payroll: PayrollService,
  ) {}

  // ── Expenses (Spec §5.8) ──
  @Post('expenses')
  @RequireScopedCapability('finance.expenses.log')
  logExpense(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.expenses.create(dto, user, reqMeta(req));
  }

  @Get('expenses/project/:projectId')
  @RequireScopedCapability('finance.expenses.log')
  projectExpenses(@Param('projectId', ParseUUIDPipe) projectId: string) {
    return this.expenses.listForProject(projectId);
  }

  // ── P&L per vertical (Spec §5.8) ──
  @Get('pnl')
  @RequireCapability('finance.pnl.view')
  pnlReport(@Query() query: FinanceRangeQuery) {
    return this.pnl.report(query);
  }

  // ── Payroll (Spec §5.8, §21) ──
  @Get('payroll/month')
  @RequireCapability('finance.payroll.export')
  month(@Query() dto: PayrollMonthDto) {
    return this.payroll.getMonth(dto.year, dto.month);
  }

  @Post('payroll/lock')
  @RequireCapability('finance.payroll.export')
  lock(@Body() dto: PayrollMonthDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.payroll.lock(dto.year, dto.month, user, reqMeta(req));
  }

  @Post('payroll/unlock')
  @RequireCapability('finance.payroll.export')
  unlock(@Body() dto: UnlockMonthDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.payroll.unlock(dto.year, dto.month, dto.reason, user, reqMeta(req));
  }

  @Post('payroll/export')
  @RequireCapability('finance.payroll.export')
  exportPayroll(@Body() dto: PayrollMonthDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.payroll.export(dto.year, dto.month, user, reqMeta(req));
  }

  @Get('payroll/exports')
  @RequireCapability('finance.payroll.export')
  exports(@Query() dto: PayrollMonthDto) {
    return this.payroll.listExports(dto.year, dto.month);
  }

  @Get('payroll/exports/:id/csv')
  @RequireCapability('finance.payroll.export')
  async exportCsv(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const snap = await this.payroll.getExport(id);
    if (!snap) {
      res.status(404).json({ message: 'Export not found' });
      return;
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payroll-${snap.year}-${snap.month}-r${snap.revision}.csv"`);
    res.send(snap.csv);
  }
}
