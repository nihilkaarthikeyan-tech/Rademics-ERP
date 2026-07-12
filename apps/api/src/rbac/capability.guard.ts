import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Grant } from '@rademics/permissions';
import type { Request } from 'express';
import { CAPABILITY_KEY_META, CAPABILITY_SCOPED_META } from './capability.decorator';
import { CapabilityService } from './capability.service';
import type { AuthUser } from '../auth/auth-user';

/**
 * Enforces the Role & Permission Matrix at the API layer (Spec §3, §10).
 * Runs AFTER JwtAuthGuard, so req.user is populated for protected routes.
 *
 * - No @RequireCapability on the route  -> pass (route is public or authentication-only).
 * - Grant ALLOW                         -> pass.
 * - Grant DENY                          -> 403 (fail closed).
 * - Grant SCOPED                        -> 403 until a resource-level scope check exists
 *                                          (Phase 2+); never silently allowed.
 */
@Injectable()
export class CapabilityGuard implements CanActivate {
  private readonly logger = new Logger(CapabilityGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly capabilities: CapabilityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const capability = this.reflector.getAllAndOverride<string | undefined>(CAPABILITY_KEY_META, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!capability) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const user = req.user;
    if (!user) {
      // A capability-guarded route must be authenticated first.
      throw new UnauthorizedException('Authentication required');
    }

    const grant = await this.capabilities.resolveGrant(user.role, user.resourceType, capability);

    if (grant === Grant.ALLOW) return true;

    if (grant === Grant.SCOPED) {
      const scopeAllowed = this.reflector.getAllAndOverride<boolean | undefined>(
        CAPABILITY_SCOPED_META,
        [context.getHandler(), context.getClass()],
      );
      // The handler opted into self-scoping (Spec §3): let it through, it MUST
      // restrict rows to the caller's scope. Otherwise fail closed.
      if (scopeAllowed) return true;
      this.logger.warn(
        `SCOPED capability "${capability}" denied for ${user.role} — route did not opt into self-scoping`,
      );
    }

    throw new ForbiddenException(`Missing capability: ${capability}`);
  }
}
