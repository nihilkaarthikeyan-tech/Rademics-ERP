import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

/**
 * Global exception filter (Spec §11). Delegates response formatting to Nest's default
 * filter, but first reports anything that is a real server fault (5xx / non-HTTP
 * exception) to Sentry. Client errors (4xx like 401/403/404/validation) are expected
 * and never reported. A no-op when Sentry has no DSN.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  override catch(exception: unknown, host: ArgumentsHost): void {
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    if (status >= 500) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }
}
