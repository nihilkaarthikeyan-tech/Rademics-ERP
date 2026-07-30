import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Turn a database constraint failure into an answer a person can act on.
 *
 * Without this, anything the service layer did not individually catch arrived as
 * `{"message":"Internal server error"}` — the same opaque 500 whether you reused
 * an email, referenced a deleted project, or typed a 400-character name. There
 * are ~26 unique constraints in the schema and ~90 write sites; only four of
 * them handled Prisma's error codes, so most collisions read as "the app broke"
 * when the truth was "that value is taken".
 *
 * Only failures whose cause is the *caller's input* are translated. Anything
 * else (a connection drop, a bad query we wrote) stays a 5xx and keeps going to
 * Sentry, because it is our bug and not something the user can fix.
 */

/**
 * Column names as they appear in the schema, mapped to how a person would say
 * them. Anything absent falls back to a de-camelCased form, so a new unique
 * column still produces a readable message without being added here.
 */
const FIELD_LABELS: Record<string, string> = {
  email: 'email address',
  employeeCode: 'employee code',
  tokenHash: 'token',
  storageKey: 'file',
  idempotencyKey: 'idempotency key',
  number: 'number',
  name: 'name',
  date: 'date',
  capabilityKey: 'capability',
  periodKey: 'period',
  versionNumber: 'version number',
  clientUserId: 'client user',
  departmentId: 'department',
  projectId: 'project',
  teamId: 'team',
  userId: 'user',
  messageId: 'message',
  fileAssetId: 'file',
  emoji: 'reaction',
  year: 'year',
  month: 'month',
  revision: 'revision',
  type: 'type',
  entryType: 'entry type',
};

function label(field: string): string {
  const known = FIELD_LABELS[field];
  if (known) return known;
  // departmentId -> "department"; standardWorkdayHours -> "standard workday hours"
  return field
    .replace(/Id$/, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

/**
 * Prisma reports the violated constraint differently per driver: an array of
 * columns, or a raw index name like `User_email_key`. Normalise both to field
 * names so the message can say *which* value collided.
 */
function fieldsFromTarget(target: unknown, modelName?: string): string[] {
  if (Array.isArray(target)) return target.filter((t): t is string => typeof t === 'string');
  if (typeof target !== 'string') return [];
  // `User_email_key` / `Invoice_year_month_key` -> the middle segments
  let inner = target.replace(/_key$/, '').replace(/_unique$/, '');
  if (modelName && inner.toLowerCase().startsWith(`${modelName.toLowerCase()}_`)) {
    inner = inner.slice(modelName.length + 1);
  }
  return inner ? inner.split('_').filter(Boolean) : [];
}

function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function thing(modelName?: string): string {
  if (!modelName) return 'record';
  return modelName.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
}

/** "an invoice" / "a payroll run" — a wrong article is the tell of a generated string. */
function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? 'An' : 'A';
}

/**
 * Prisma names a foreign key in several shapes depending on the driver and version:
 * `Task_projectId_fkey (index)`, `Task_projectId_fkey`, or plain `projectId`. Reduce
 * all of them to the column, so the message can say which selection was bad.
 */
function fieldFromConstraint(raw: string, modelName?: string): string | null {
  let s = raw
    .replace(/\s*\((?:index|constraint|foreign key)\)\s*$/i, '')
    .replace(/_fkey$/i, '')
    .trim();
  if (modelName && s.toLowerCase().startsWith(`${modelName.toLowerCase()}_`)) {
    s = s.slice(modelName.length + 1);
  } else if (s.includes('_')) {
    // No model to strip, but a compound name still ends with the column.
    s = s.slice(s.indexOf('_') + 1);
  }
  return s ? label(s) : null;
}

/**
 * @returns an HttpException carrying a message worth showing a user, or null when
 *          the failure is not the caller's fault and should stay a 500.
 */
export function toHttpException(err: unknown): HttpException | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return null;

  const meta = (err.meta ?? {}) as {
    target?: unknown;
    modelName?: string;
    field_name?: string;
    cause?: string;
    column_name?: string;
  };
  const model = meta.modelName;

  switch (err.code) {
    // Unique constraint — the single most common one a user can actually cause.
    case 'P2002': {
      const fields = fieldsFromTarget(meta.target, model).map(label);
      if (fields.length === 0) {
        return new ConflictException(`That ${thing(model)} already exists`);
      }
      if (fields.length === 1) {
        return new ConflictException(`That ${fields[0]} is already in use`);
      }
      const noun = thing(model);
      return new ConflictException(
        `${article(noun)} ${noun} with this ${list(fields)} already exists`,
      );
    }

    // Foreign key failed: pointing at something that is gone or never existed.
    case 'P2003': {
      const raw = meta.field_name ?? meta.column_name;
      const field = typeof raw === 'string' ? fieldFromConstraint(raw, model) : null;
      return new BadRequestException(
        field
          ? `The ${field} you selected no longer exists`
          : 'One of the linked records no longer exists',
      );
    }

    // Deleting/updating something another row still depends on.
    case 'P2014':
      return new BadRequestException(
        `This ${thing(model)} is still linked to other records, so it cannot be changed`,
      );

    // The row the write targeted is not there (deleted in another tab, usually).
    case 'P2025': {
      const because = typeof meta.cause === 'string' ? meta.cause : null;
      return new NotFoundException(
        because && /not found/i.test(because)
          ? `That ${thing(model)} no longer exists`
          : `That ${thing(model)} no longer exists — it may have been deleted`,
      );
    }
    case 'P2001':
      return new NotFoundException(`That ${thing(model)} no longer exists`);

    // Value the caller sent does not fit the column.
    case 'P2000': {
      const raw = meta.column_name;
      const field = typeof raw === 'string' ? label(raw) : null;
      return new BadRequestException(
        field ? `The ${field} you entered is too long` : 'One of the values you entered is too long',
      );
    }
    case 'P2011': {
      const raw = meta.column_name ?? (meta as { constraint?: string }).constraint;
      const field = typeof raw === 'string' ? label(raw) : null;
      return new BadRequestException(field ? `${field} is required` : 'A required value is missing');
    }
    case 'P2012': {
      const raw = (meta as { path?: string }).path;
      const field = typeof raw === 'string' ? label(raw.split('/').pop() ?? raw) : null;
      return new BadRequestException(field ? `${field} is required` : 'A required value is missing');
    }

    // Required relation missing / inconsistent connect.
    case 'P2018':
      return new BadRequestException('One of the records you linked to could not be found');
    case 'P2015':
      return new NotFoundException(`That ${thing(model)} could not be found`);

    // Everything else (P1xxx connection faults, P2010 raw query, ...) is ours.
    default:
      return null;
  }
}
