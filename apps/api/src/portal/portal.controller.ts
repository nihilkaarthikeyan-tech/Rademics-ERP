import { Controller, Get, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PortalService } from './portal.service';
import { InvoicesService } from '../finance/invoices.service';
import { buildInvoicePdf } from '../finance/invoice-pdf';
import { RequireCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth-user';

/**
 * Client-facing portal API (Spec §5.5). Client-only capabilities; every response is
 * scoped in PortalService. Internal roles have these capabilities DENIED, so they
 * cannot reach the portal surface at all.
 *
 * 2026-07-27: view + request-status only — no approve/request-revision. The
 * client's write surface is exactly one action. Invoices are readable here
 * (later the same day) because correspondence no longer goes out by email, so
 * a bill has to arrive somewhere the client can actually read it.
 */
@Controller('portal')
export class PortalController {
  constructor(
    private readonly portal: PortalService,
    private readonly invoicesService: InvoicesService,
  ) {}

  @Get('projects')
  @RequireCapability('portal.progress.view')
  projects(@CurrentUser() user: AuthUser) {
    return this.portal.listProjects(user);
  }

  @Get('projects/:id')
  @RequireCapability('portal.progress.view')
  project(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.getProject(id, user);
  }

  @Get('tasks/:id/files')
  @RequireCapability('portal.files.download')
  files(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.listFiles(id, user);
  }

  /** Progress feed: client-visible comments staff posted on this task. */
  @Get('tasks/:id/updates')
  @RequireCapability('portal.progress.view')
  updates(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.listUpdates(id, user);
  }

  /** "Ask for a status update" — the client's only write action. */
  @Post('tasks/:id/request-status')
  @RequireCapability('portal.progress.view')
  requestStatus(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.requestStatus(id, user);
  }

  @Get('files/versions/:id/download')
  @RequireCapability('portal.files.download')
  download(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.portal.download(id, user);
  }

  /** The client's own invoices — sent ones only, never Finance's drafts. */
  @Get('invoices')
  @RequireCapability('portal.progress.view')
  invoices(@CurrentUser() user: AuthUser) {
    return this.portal.listInvoices(user);
  }

  /**
   * The invoice document. Access is re-checked here rather than trusted from
   * the list call — this streams a financial record, so the request that
   * fetches it has to stand on its own.
   */
  @Get('invoices/:id/pdf')
  @RequireCapability('portal.progress.view')
  async invoicePdf(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ) {
    await this.portal.assertInvoiceAccess(id, user);
    const inv = await this.invoicesService.get(id);
    const config = await this.invoicesService.getConfig();
    const doc = buildInvoicePdf(
      {
        number: inv.number,
        status: inv.status,
        issueDate: inv.issueDate,
        dueDate: inv.dueDate,
        subtotal: Number(inv.subtotal),
        gstAmount: Number(inv.gstAmount),
        total: Number(inv.total),
        amountPaid: Number(inv.amountPaid),
        notes: inv.notes,
        footerText: inv.footerText,
        clientName: inv.clientOrg?.name ?? null,
        projectName: inv.project?.name ?? null,
        lines: inv.lines.map((l) => ({
          description: l.description,
          quantity: Number(l.quantity),
          rate: Number(l.rate),
          gstPercent: Number(l.gstPercent),
          lineTotal: Number(l.lineTotal),
        })),
      },
      config,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${inv.number}.pdf"`);
    doc.pipe(res);
    doc.end();
  }
}
