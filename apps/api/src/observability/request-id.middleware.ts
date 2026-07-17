import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import * as Sentry from '@sentry/node';
import type { Request, Response, NextFunction } from 'express';

/** Header used to both accept an upstream id and echo ours back (Spec §11). */
export const REQUEST_ID_HEADER = 'x-request-id';

/** A request that has passed through RequestIdMiddleware. Matches the codebase's
 *  `Request & { user?: AuthUser }` idiom rather than augmenting the express module. */
export type RequestWithId = Request & { requestId?: string };

/** A client-supplied id is only trusted if it's short and boring — it ends up in log
 *  lines and Sentry tags, so reject anything that could inject or explode cardinality. */
const SAFE_ID = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Assigns every request a correlation id (Spec §11) so a user's "it broke" report can
 * be tied to the exact Sentry event. Reuses a valid inbound X-Request-Id (so a future
 * reverse proxy or a portal->API hop keeps one id across services), otherwise mints a
 * UUID. The id is echoed on the response header, tagged onto the request's Sentry
 * isolation scope, and surfaced in 5xx bodies by SentryExceptionFilter.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
    const requestId = candidate && SAFE_ID.test(candidate) ? candidate : randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    // No-op when Sentry has no DSN. The isolation scope is per-request (created by the
    // SDK's http integration), so this tag can't leak onto a concurrent request.
    Sentry.getIsolationScope().setTag('request_id', requestId);

    next();
  }
}
