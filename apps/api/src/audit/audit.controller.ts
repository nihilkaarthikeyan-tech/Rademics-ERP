import { Controller, Get, Query } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditQueryDto } from './dto';
import { RequireCapability } from '../rbac/capability.decorator';

/** Read-only audit-log viewer (Spec §5.10). Super Admin only (audit.log.view). */
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequireCapability('audit.log.view')
  list(@Query() query: AuditQueryDto) {
    return this.audit.list(query);
  }
}
