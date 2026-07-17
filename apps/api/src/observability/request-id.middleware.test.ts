import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import { RequestIdMiddleware, REQUEST_ID_HEADER, type RequestWithId } from './request-id.middleware';

function run(headers: Record<string, string | string[]> = {}) {
  const req = { headers } as unknown as RequestWithId;
  const res = { setHeader: vi.fn() } as unknown as Response;
  const next = vi.fn();
  new RequestIdMiddleware().use(req, res, next);
  return { req, res, next };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('RequestIdMiddleware', () => {
  it('mints a uuid when no id is supplied and echoes it on the response', () => {
    const { req, res, next } = run();
    expect(req.requestId).toMatch(UUID);
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.requestId);
    expect(next).toHaveBeenCalledOnce();
  });

  it('gives each request its own id', () => {
    expect(run().req.requestId).not.toBe(run().req.requestId);
  });

  it('reuses a well-formed inbound id so one id spans a portal -> API hop', () => {
    const { req } = run({ [REQUEST_ID_HEADER]: 'abc-123_XY.z' });
    expect(req.requestId).toBe('abc-123_XY.z');
  });

  // The id lands in Sentry tags and log lines, so anything odd gets replaced rather
  // than trusted — these are the cases that would otherwise inject or blow up cardinality.
  it.each([
    ['too short', 'short'],
    ['too long', 'a'.repeat(65)],
    ['header injection', 'abcdefgh\r\nX-Evil: 1'],
    ['illegal characters', 'abcdefgh<script>'],
    ['empty', ''],
  ])('replaces an untrusted inbound id (%s)', (_label, value) => {
    const { req } = run({ [REQUEST_ID_HEADER]: value });
    expect(req.requestId).not.toBe(value);
    expect(req.requestId).toMatch(UUID);
  });

  it('takes the first value when the header is repeated', () => {
    const { req } = run({ [REQUEST_ID_HEADER]: ['abcdefgh1', 'second-one'] });
    expect(req.requestId).toBe('abcdefgh1');
  });
});
