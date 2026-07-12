import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { InvoicesService } from './invoices.service';
import { buildInvoicePdf } from './invoice-pdf';
import {
  CancelInvoiceDto,
  CreateInvoiceDto,
  CreatePaymentDto,
  ReversePaymentDto,
} from './dto';
import { RequireCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

const num = (d: unknown) => Number(d ?? 0);

@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @RequireCapability('finance.invoices.create_edit')
  list(@Query('status') status?: string) {
    return this.invoices.list(status);
  }

  @Get('dues')
  @RequireCapability('finance.payments.record')
  dues() {
    return this.invoices.dues();
  }

  // Run the overdue sweep on demand (the job also runs daily — Spec §5.8).
  @Post('run-overdue-sweep')
  @RequireCapability('finance.invoices.create_edit')
  sweep() {
    return this.invoices.sweepOverdue();
  }

  @Get(':id')
  @RequireCapability('finance.invoices.create_edit')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.invoices.get(id);
  }

  @Post()
  @RequireCapability('finance.invoices.create_edit')
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.invoices.create(dto, user, reqMeta(req));
  }

  @Post('from-project/:projectId')
  @RequireCapability('finance.invoices.create_edit')
  fromProject(@Param('projectId', ParseUUIDPipe) projectId: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.invoices.createFromProject(projectId, user, reqMeta(req));
  }

  @Put(':id')
  @RequireCapability('finance.invoices.create_edit')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateInvoiceDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.invoices.updateDraft(id, dto, user, reqMeta(req));
  }

  @Post(':id/send')
  @RequireCapability('finance.invoices.create_edit')
  send(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.invoices.send(id, user, reqMeta(req));
  }

  @Post(':id/cancel')
  @RequireCapability('finance.invoices.create_edit')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelInvoiceDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.invoices.cancel(id, dto, user, reqMeta(req));
  }

  @Post(':id/reissue')
  @RequireCapability('finance.invoices.create_edit')
  reissue(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelInvoiceDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.invoices.reissue(id, dto, user, reqMeta(req));
  }

  // ── Payments (Spec §5.8) ──
  @Post(':id/payments')
  @RequireCapability('finance.payments.record')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreatePaymentDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.invoices.recordPayment(id, dto, user, reqMeta(req));
  }

  @Post('payments/:paymentId/reverse')
  @RequireCapability('finance.payments.record')
  reverse(@Param('paymentId', ParseUUIDPipe) paymentId: string, @Body() dto: ReversePaymentDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    return this.invoices.reversePayment(paymentId, dto, user, reqMeta(req));
  }

  // ── Branded PDF (Spec §5.8) ──
  @Get(':id/pdf')
  @RequireCapability('finance.invoices.create_edit')
  async pdf(@Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const inv = await this.invoices.get(id);
    const config = await this.invoices.getConfig();
    const doc = buildInvoicePdf(
      {
        number: inv.number,
        status: inv.status,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        subtotal: num(inv.subtotal),
        gstAmount: num(inv.gstAmount),
        total: num(inv.total),
        amountPaid: num(inv.amountPaid),
        notes: inv.notes,
        footerText: inv.footerText,
        clientName: inv.clientOrg?.name ?? null,
        projectName: inv.project?.name ?? null,
        lines: inv.lines.map((l) => ({ description: l.description, quantity: num(l.quantity), rate: num(l.rate), gstPercent: num(l.gstPercent), lineTotal: num(l.lineTotal) })),
      },
      config,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${inv.number}.pdf"`);
    doc.pipe(res);
    doc.end();
  }
}
