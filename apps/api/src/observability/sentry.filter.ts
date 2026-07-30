import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import type { Response } from 'express';
import type { RequestWithId } from './request-id.middleware';
import { toHttpException } from './prisma-error';

/**
 * Global exception filter (Spec §11). Delegates response formatting to Nest's default
 * filter, but first reports anything that is a real server fault (5xx / non-HTTP
 * exception) to Sentry. Client errors (4xx like 401/403/404/validation) are expected
 * and never reported. A no-op when Sentry has no DSN.
 *
 * For 5xx over HTTP the body is replaced with a fixed shape carrying the request id
 * (set by RequestIdMiddleware) so a user can quote it and we can find the exact Sentry
 * event. The message is deliberately generic — internal fault details never cross the
 * wire (Spec §10).
 *
 * Database constraint failures are translated first (see prisma-error.ts). They are
 * caused by what the caller sent, not by a fault here, so they belong in the 4xx
 * branch with a message that names the problem — not in the opaque 500 above. Done
 * here rather than in a second @Catch(Prisma...) filter so there is no dependence on
 * which global filter Nest happens to consult first.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const translated = toHttpException(exception);
    if (translated) {
      super.catch(translated, host);
      return;
    }

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status < 500) {
      super.catch(exception, host);
      return;
    }

    const requestId =
      host.getType() === 'http'
        ? host.switchToHttp().getRequest<RequestWithId>().requestId
        : undefined;

    Sentry.captureException(exception, requestId ? { tags: { request_id: requestId } } : undefined);

    if (host.getType() !== 'http') {
      super.catch(exception, host);
      return;
    }

    const res = host.switchToHttp().getResponse<Response>();
    res.status(status).json({
      statusCode: status,
      message: 'Internal server error',
      ...(requestId ? { requestId } : {}),
    });
  }
}
