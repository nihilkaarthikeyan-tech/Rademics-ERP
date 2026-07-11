import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { AuthUser } from './auth-user';

export const IS_PUBLIC_META = 'auth:isPublic';

/** Marks a route as accessible without authentication (Spec §5.1 — login, invite, reset). */
export const Public = () => SetMetadata(IS_PUBLIC_META, true);

/** Injects the authenticated user into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser | undefined => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    return req.user;
  },
);
