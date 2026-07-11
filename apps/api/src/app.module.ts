import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { validateEnv } from './config/env';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { RbacModule } from './rbac/rbac.module';
import { EncryptionModule } from './crypto/encryption.module';
import { MailModule } from './mail/mail.module';
import { QueueModule } from './queue/queue.module';
import { AuthModule } from './auth/auth.module';
import { PeopleModule } from './people/people.module';
import { SettingsModule } from './settings/settings.module';
import { HealthController } from './health/health.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CapabilityGuard } from './rbac/capability.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuditModule,
    RbacModule,
    EncryptionModule,
    MailModule,
    QueueModule,
    AuthModule,
    PeopleModule,
    SettingsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global guards run in order: authenticate first, then check capability (Spec §3, §10).
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CapabilityGuard },
  ],
})
export class AppModule {}
