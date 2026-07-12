import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';
import { Public } from '../auth/decorators';

/**
 * Prometheus scrape endpoint (Spec §11). Public so the metrics collector can reach it
 * without app credentials — in production this path is firewalled / behind the reverse
 * proxy to the monitoring network, not exposed publicly.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  async scrape(@Res() res: Response): Promise<void> {
    res.setHeader('Content-Type', this.metrics.contentType());
    res.send(await this.metrics.render());
  }
}
