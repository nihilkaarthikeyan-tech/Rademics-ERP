import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { Public } from '../auth/decorators';
import { RequireCapability } from '../rbac/capability.decorator';

interface HealthReport {
  status: 'ok' | 'degraded';
  db: 'up' | 'down';
  release: string | null;
  time: string;
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness probe for the external uptime monitor (Spec §11). The STATUS CODE is the
   * contract: 200 healthy, 503 degraded. It previously returned 200 even when the DB
   * was down, which a monitor reads as healthy — a total outage would have looked fine.
   * Body is informational; `release` lets you confirm which build is actually live.
   */
  @Public()
  @Get()
  async check(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      db = 'down';
    }
    const status = db === 'up' ? 'ok' : 'degraded';
    // Set explicitly rather than throwing: a 503 exception would flow through
    // SentryExceptionFilter and spam an issue on every monitor poll during an outage.
    res.status(status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status,
      db,
      release: process.env.SENTRY_RELEASE || null,
      time: new Date().toISOString(),
    };
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
