import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BadRequestException, HttpException, HttpStatus, type ArgumentsHost } from '@nestjs/common';

const captureException = vi.fn();
vi.mock('@sentry/node', () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

// BaseExceptionFilter's real catch() needs an http adapter; stub it so these tests
// isolate this filter's own decisions (report or not, which body to send).
const superCatch = vi.fn();
vi.mock('@nestjs/core', () => ({
  BaseExceptionFilter: class {
    catch(...a: unknown[]) {
      superCatch(...a);
    }
  },
}));

const { SentryExceptionFilter } = await import('./sentry.filter');

function makeHost(requestId?: string) {
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) };
  const host = {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => ({ requestId }), getResponse: () => res }),
  } as unknown as ArgumentsHost;
  return { host, res, json };
}

describe('SentryExceptionFilter', () => {
  beforeEach(() => {
    captureException.mockClear();
    superCatch.mockClear();
  });

  it('does not report a 4xx — expected client error, delegates formatting', () => {
    const { host } = makeHost('req-1');
    new SentryExceptionFilter().catch(new BadRequestException('bad'), host);
    expect(captureException).not.toHaveBeenCalled();
    expect(superCatch).toHaveBeenCalledOnce();
  });

  it('reports a non-HttpException as a 500 and tags it with the request id', () => {
    const { host, res, json } = makeHost('req-2');
    new SentryExceptionFilter().catch(new Error('boom'), host);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { request_id: 'req-2' },
    });
    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Internal server error',
      requestId: 'req-2',
    });
  });

  it('reports an explicit 5xx HttpException', () => {
    const { host } = makeHost('req-3');
    new SentryExceptionFilter().catch(new HttpException('down', 503), host);
    expect(captureException).toHaveBeenCalledOnce();
  });

  it('never leaks the internal fault message to the client', () => {
    const { json } = (() => {
      const h = makeHost('req-4');
      new SentryExceptionFilter().catch(new Error('secret db dsn leaked here'), h.host);
      return h;
    })();
    expect(JSON.stringify(json.mock.calls)).not.toContain('secret db dsn');
  });

  it('still responds when no request id is present', () => {
    const { host, json } = makeHost(undefined);
    new SentryExceptionFilter().catch(new Error('boom'), host);
    expect(captureException).toHaveBeenCalledWith(expect.any(Error), undefined);
    expect(json).toHaveBeenCalledWith({ statusCode: 500, message: 'Internal server error' });
  });
});
