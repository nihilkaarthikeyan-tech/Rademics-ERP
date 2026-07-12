import { Controller, Get } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators';
import { RequireCapability } from '../rbac/capability.decorator';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<{ status: string; db: 'up' | 'down'; time: string }> {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    return { status: db === 'up' ? 'ok' : 'degraded', db, time: new Date().toISOString() };
  }

  /**
   * Deliberate 500 so ops can confirm Sentry receives errors from the API (Spec §11).
   * SA-gated (not public) so it can't be used to spam noise; the thrown error flows
   * through the SentryExceptionFilter like any real fault.
   */
  @Get('debug-sentry')
  @RequireCapability('admin.settings.manage')
  triggerError(): never {
    throw new Error('Sentry test error (API) — triggered from /api/health/debug-sentry');
  }
}
