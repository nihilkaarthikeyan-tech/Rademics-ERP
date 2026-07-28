import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionStateService } from './session-state.service';
import { TurnstileService } from './turnstile.service';

/**
 * Global because JwtAuthGuard is registered as an APP_GUARD in AppModule and now
 * depends on SessionStateService — a global guard is constructed outside any
 * module's injector, so its dependencies have to be reachable from everywhere.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TurnstileService, SessionStateService],
  exports: [AuthService, SessionStateService, JwtModule],
})
export class AuthModule {}
