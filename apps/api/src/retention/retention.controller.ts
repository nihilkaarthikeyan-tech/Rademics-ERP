import { Controller, Post } from '@nestjs/common';
import { RetentionService, RetentionResult } from './retention.service';
import { RequireCapability } from '../rbac/capability.decorator';

/** On-demand retention trigger for ops/verification (Spec §4 Data settings, §10). */
@Controller('admin/retention')
export class RetentionController {
  constructor(private readonly retention: RetentionService) {}

  @Post('run')
  @RequireCapability('admin.settings.manage')
  run(): Promise<RetentionResult> {
    return this.retention.runAll();
  }
}
