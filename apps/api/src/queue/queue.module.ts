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
