import {
  IsEnum,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export type LeaveTypeDto = 'CASUAL' | 'SICK' | 'EARNED' | 'UNPAID';
export type LeaveHalfDto = 'FULL' | 'FIRST_HALF' | 'SECOND_HALF';

/** Request leave (Spec §5.7, §24). Half-day is a single day only (checked in service). */
export class CreateLeaveDto {
  @IsEnum(['CASUAL', 'SICK', 'EARNED', 'UNPAID'] as const, { message: 'Invalid leave type' })
  type!: LeaveTypeDto;

  @IsISO8601()
  fromDate!: string; // 'YYYY-MM-DD'

  @IsISO8601()
  toDate!: string; // 'YYYY-MM-DD'

  @IsOptional()
  @IsEnum(['FULL', 'FIRST_HALF', 'SECOND_HALF'] as const, { message: 'Invalid half-day value' })
  half?: LeaveHalfDto;

  @IsString()
  @MinLength(5, { message: 'Reason must be at least 5 characters' })
  @MaxLength(500)
  reason!: string;
}

/** Approve / reject a leave request (Spec §5.7). Rejection should carry a comment. */
export class DecideLeaveDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

/** Team leave calendar window (Spec §5.7). */
export class LeaveCalendarQuery {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

/** Add a company holiday (Spec §5.13, §25 recompute). */
export class CreateHolidayDto {
  @IsISO8601()
  date!: string; // 'YYYY-MM-DD'

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;
}
