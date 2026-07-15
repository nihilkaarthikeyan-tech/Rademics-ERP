import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
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
import { AttendanceModule } from './attendance/attendance.module';
import { NotificationsModule } from './notifications/notifications.module';
import { ProjectsModule } from './projects/projects.module';
import { StorageModule } from './storage/storage.module';
import { FilesModule } from './files/files.module';
import { PortalModule } from './portal/portal.module';
import { LeaveModule } from './leave/leave.module';
import { FinanceModule } from './finance/finance.module';
import { AiModule } from './ai/ai.module';
import { ReportsModule } from './reports/reports.module';
import { RetentionModule } from './retention/retention.module';
import { ObservabilityModule } from './observability/observability.module';
import { SentryExceptionFilter } from './observability/sentry.filter';
import { HealthController } from './health/health.controller';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CapabilityGuard } from './rbac/capability.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Bot / abuse protection (Spec §10): baseline per-IP cap on every route. Sensitive
    // auth endpoints (login, forgot-password, ...) override with a stricter limit — see
    // the @Throttle() decorators in auth.controller.ts. Kept generous (not per-account
    // tight) since many employees can share one office IP behind NAT.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    AuditModule,
    RbacModule,
    EncryptionModule,
    MailModule,
    QueueModule,
    AuthModule,
    PeopleModule,
    SettingsModule,
    AttendanceModule,
    NotificationsModule,
    ProjectsModule,
    StorageModule,
    FilesModule,
    PortalModule,
    LeaveModule,
    FinanceModule,
    AiModule,
    ReportsModule,
    RetentionModule,
    ObservabilityModule,
  ],
  controllers: [HealthController],
  providers: [
    // Global guards run in order: throttle abuse first (before spending CPU on auth),
    // then authenticate, then check capability (Spec §3, §10).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: CapabilityGuard },
    // Report 5xx faults to Sentry (Spec §11); no-op without a DSN.
    { provide: APP_FILTER, useClass: SentryExceptionFilter },
  ],
})
export class AppModule {}
