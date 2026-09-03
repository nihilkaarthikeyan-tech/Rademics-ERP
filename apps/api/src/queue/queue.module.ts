import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EmailProducer } from './email.producer';
import { EmailProcessor } from './email.processor';
import { QUEUE_EMAIL } from './queue.constants';

/** BullMQ wiring (Redis-backed). All long work runs here (Spec §11, §12). */
@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.get<string>('REDIS_URL', 'redis://localhost:6379'));
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port || 6379),
            password: url.password || undefined,
            // A loaded host can be slow to accept a connection even when Redis is
            // healthy: on 2026-09-01 the API logged 54 straight `connect ETIMEDOUT`
            // while Redis itself never restarted. Defaults gave up too readily and
            // background work (invite/notification email, file scans, nightly jobs)
            // failed silently. Wait longer for the handshake and keep retrying with
            // a capped backoff instead of surfacing the connect as a hard error.
            connectTimeout: 20_000,
            maxRetriesPerRequest: null, // required by BullMQ; retry forever rather than throw
            enableOfflineQueue: true, // hold commands while reconnecting instead of failing them
            retryStrategy: (times: number) => Math.min(times * 500, 10_000),
            reconnectOnError: () => true,
          },
        };
      },
    }),
    BullModule.registerQueue({ name: QUEUE_EMAIL }),
  ],
  providers: [EmailProducer, EmailProcessor],
  exports: [EmailProducer, BullModule],
})
export class QueueModule {}
