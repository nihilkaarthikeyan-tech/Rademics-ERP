import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * Shared page/pageSize query, matching the shape AuditQueryDto established.
 *
 * Lists that grow without bound — invoices, expense entries, regularization
 * requests — used to answer with the whole table. That is fine on day one and
 * quietly gets worse every day: the server holds every row in memory, ships all
 * of it, and the browser tries to draw it. `Max(100)` is the important part; it
 * is a ceiling the caller cannot raise, so one query can never be unbounded
 * again regardless of what the client asks for.
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be a whole number' })
  @Min(1, { message: 'page must be 1 or more' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'pageSize must be a whole number' })
  @Min(1, { message: 'pageSize must be 1 or more' })
  @Max(100, { message: 'pageSize cannot exceed 100' })
  pageSize?: number;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 50;

/** Resolve page/pageSize into Prisma's skip/take, clamped so the ceiling always holds. */
export function pageArgs(query: { page?: number; pageSize?: number } | undefined): {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
} {
  const page = Math.max(1, Math.trunc(query?.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.trunc(query?.pageSize ?? DEFAULT_PAGE_SIZE)));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
