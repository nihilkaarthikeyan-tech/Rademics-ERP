import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ReportsService, type ReportQuery } from './reports.service';
import { reportToCsv, reportToPdf } from './report-export';
import { AuditService } from '../audit/audit.service';
import { RequireScopedCapability } from '../rbac/capability.decorator';
import { CurrentUser } from '../auth/decorators';
import { reqMeta } from '../common/req-meta';
import type { AuthUser } from '../auth/auth-user';

/** Reports & capacity (Spec §5.11, §5.9, §21). Role-scoped via reports.dashboard.view. */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly audit: AuditService,
  ) {}

  @Get('capacity')
  @RequireScopedCapability('reports.dashboard.view')
  capacity(@CurrentUser() user: AuthUser) {
    return this.reports.capacity(user);
  }

  @Get('attendance')
  @RequireScopedCapability('reports.dashboard.view')
  attendance(@Query() q: ReportQuery, @CurrentUser() user: AuthUser) {
    return this.reports.attendance(user, q);
  }

  @Get('productivity')
  @RequireScopedCapability('reports.dashboard.view')
  productivity(@Query() q: ReportQuery, @CurrentUser() user: AuthUser) {
    return this.reports.productivity(user, q);
  }

  @Get('project-status')
  @RequireScopedCapability('reports.dashboard.view')
  projectStatus(@CurrentUser() user: AuthUser) {
    return this.reports.projectStatus(user);
  }

  // ── Exports (Spec §5.11 CSV/PDF; §5.10 logs data exports) ──
  @Get(':type/export')
  @RequireScopedCapability('reports.dashboard.view')
  async export(
    @Param('type') type: string,
    @Query('format') format: string,
    @Query() q: ReportQuery,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const data = await this.reports.build(type, user, q);
    await this.audit.record({
      actorId: user.id, actorEmail: user.email, action: 'REPORT_EXPORTED',
      entityType: 'Report', entityId: type, after: { format, rows: data.rows.length }, ...reqMeta(req),
    });
    if (format === 'pdf') {
      const doc = reportToPdf(data);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${type}-report.pdf"`);
      doc.pipe(res);
      doc.end();
      return;
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-report.csv"`);
    res.send(reportToCsv(data));
  }
}
