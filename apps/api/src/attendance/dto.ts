import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceSource } from '@prisma/client';

/** Check-in (Spec §5.3). Optional client key makes retries idempotent (§25). */
export class CheckInDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  idempotencyKey?: string;

  // Omitted by the website (defaults to WEB); the desktop agent sends DESKTOP.
  @IsOptional()
  @IsEnum(AttendanceSource)
  source?: AttendanceSource;
}

/** Check-out. `reconcile` is set by the desktop agent when it completes a checkout
 *  a prior OS shutdown couldn't send — the server then closes at the last heartbeat. */
export class CheckOutDto {
  @IsOptional()
  @IsBoolean()
  reconcile?: boolean;
}

/** Activity heartbeat for idle tracking (Spec §5.3). */
export class HeartbeatDto {
  // No body needed; kept for forward-compat (e.g. client-reported activity ts).
  @IsOptional()
  @IsString()
  @MaxLength(100)
  clientTs?: string;
}

/** Regularization request (Spec §5.3, §24: reason ≥ 10 chars). */
export class CreateRegularizationDto {
  @IsISO8601()
  date!: string; // 'YYYY-MM-DD' the correction applies to

  @IsString()
  @MinLength(10, { message: 'Reason must be at least 10 characters' })
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsISO8601()
  requestedCheckInAt?: string;

  @IsOptional()
  @IsISO8601()
  requestedCheckOutAt?: string;
}

/** Approve / reject a regularization (Spec §5.3). */
export class DecideRegularizationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

/** Attendance history/list query (Spec §19 table standards). */
export class AttendanceHistoryQuery {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 31;
}

/** Team / all-attendance list query. */
export class AttendanceListQuery extends AttendanceHistoryQuery {
  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;
}
