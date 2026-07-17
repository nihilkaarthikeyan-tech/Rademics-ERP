import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsMiddleware } from './metrics.middleware';
import { RequestIdMiddleware } from './request-id.middleware';

/** Phase 10 — Observability (Spec §11): Prometheus /metrics + request instrumentation.
 *  Sentry is initialised in instrument.ts (before app bootstrap) and reported via the
 *  global SentryExceptionFilter. */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Request id first: everything downstream (metrics, guards, the exception filter)
    // reads req.requestId.
    consumer.apply(RequestIdMiddleware, MetricsMiddleware).forRoutes('*');
  }
}
