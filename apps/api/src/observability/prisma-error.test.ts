import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { toHttpException } from './prisma-error';

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('db said no', {
    code,
    clientVersion: '5.22.0',
    meta,
  });

/** What the caller would actually see on the wire. */
const seen = (err: unknown) => {
  const http = toHttpException(err);
  if (!http) return null;
  const body = http.getResponse() as { message?: string } | string;
  return {
    status: http.getStatus(),
    message: typeof body === 'string' ? body : (body.message ?? ''),
  };
};

describe('toHttpException — unique constraints (P2002)', () => {
  it('names the field when Prisma gives a column array', () => {
    expect(seen(known('P2002', { target: ['email'], modelName: 'User' }))).toEqual({
      status: 409,
      message: 'That email address is already in use',
    });
  });

  it('parses an index name when the driver reports one instead', () => {
    expect(seen(known('P2002', { target: 'User_email_key', modelName: 'User' }))).toEqual({
      status: 409,
      message: 'That email address is already in use',
    });
  });

  it('lists both fields of a composite constraint', () => {
    expect(seen(known('P2002', { target: ['year', 'month'], modelName: 'PayrollRun' }))?.message).toBe(
      'A payroll run with this year and month already exists',
    );
  });

  it('reads a composite index name without duplicating the model', () => {
    expect(
      seen(known('P2002', { target: 'Invoice_year_month_revision_key', modelName: 'Invoice' }))?.message,
    ).toBe('An invoice with this year, month and revision already exists');
  });

  it('falls back to the model when the field is unknown', () => {
    expect(seen(known('P2002', { modelName: 'LeaveBalance' }))).toEqual({
      status: 409,
      message: 'That leave balance already exists',
    });
  });

  it('humanises a field it has never seen', () => {
    expect(seen(known('P2002', { target: ['someNewColumn'] }))?.message).toBe(
      'That some new column is already in use',
    );
  });

  it('strips the Id suffix so it reads as the thing, not the column', () => {
    expect(seen(known('P2002', { target: ['departmentId'] }))?.message).toBe(
      'That department is already in use',
    );
  });
});

describe('toHttpException — other caller-caused failures', () => {
  it('maps a missing row to 404', () => {
    expect(seen(known('P2025', { modelName: 'Task', cause: 'Record to update not found.' }))).toEqual({
      status: 404,
      message: 'That task no longer exists',
    });
  });

  it('maps a broken foreign key to 400 naming the field', () => {
    expect(seen(known('P2003', { field_name: 'Task_projectId_fkey (index)' }))).toEqual({
      status: 400,
      message: 'The project you selected no longer exists',
    });
  });

  it('maps an over-long value to 400', () => {
    expect(seen(known('P2000', { column_name: 'name' }))).toEqual({
      status: 400,
      message: 'The name you entered is too long',
    });
  });

  it('maps a null violation to a required-field message', () => {
    expect(seen(known('P2011', { column_name: 'email' }))).toEqual({
      status: 400,
      message: 'email address is required',
    });
  });

  it('explains a still-linked record rather than failing opaquely', () => {
    expect(seen(known('P2014', { modelName: 'Department' }))).toEqual({
      status: 400,
      message: 'This department is still linked to other records, so it cannot be changed',
    });
  });
});

describe('toHttpException — what it must NOT swallow', () => {
  it('leaves connection faults alone so they stay a 500 and reach Sentry', () => {
    expect(toHttpException(known('P1001'))).toBeNull();
    expect(toHttpException(known('P2010'))).toBeNull();
  });

  it('ignores anything that is not a Prisma known-request error', () => {
    expect(toHttpException(new Error('boom'))).toBeNull();
    expect(toHttpException(new Prisma.PrismaClientValidationError('bad args', { clientVersion: '5.22.0' }))).toBeNull();
    expect(toHttpException(undefined)).toBeNull();
    expect(toHttpException(null)).toBeNull();
  });

  it('never leaks the raw database text', () => {
    const raw = 'Unique constraint failed on the fields: (`email`) in table `User`';
    const err = new Prisma.PrismaClientKnownRequestError(raw, {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target: ['email'] },
    });
    expect(seen(err)?.message).not.toContain('constraint');
    expect(seen(err)?.message).not.toContain('User');
  });
});
