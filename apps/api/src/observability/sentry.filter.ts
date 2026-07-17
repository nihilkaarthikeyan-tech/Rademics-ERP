import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';
import type { Response } from 'express';
import type { RequestWithId } from './request-id.middleware';

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
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
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
