import { IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Read-only filters for the audit-log viewer (Spec §5.10) — gated by audit.log.view. */
export class AuditQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;

  /** Substring match on the action name, e.g. "LOGIN" or "CLIENT_ACCESS". */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  /** Exact entity type, e.g. "User", "Task", "Invoice". */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  entityType?: string;

  /** Substring match on the actor's email. */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  actorEmail?: string;

  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}
