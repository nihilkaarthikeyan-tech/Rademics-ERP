import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

/**
 * Records one sample per HTTP request on response finish (Spec §11). Uses the matched
 * ROUTE pattern (e.g. /api/tasks/:id) rather than the raw path so metric cardinality
 * stays bounded — UUIDs never explode the label set. Unmatched paths → "unmatched".
 */
@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      const base = (req.baseUrl ?? '') + (req.route?.path ?? '');
      const route = base || 'unmatched';
      this.metrics.observe(req.method, route, res.statusCode, seconds);
    });
    next();
  }
}
