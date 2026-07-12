import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

/** One line on an invoice (Spec §5.8, §24: qty > 0, rate ≥ 0, GST 0–28). */
export class InvoiceLineDto {
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  description!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Quantity must be greater than 0' })
  quantity!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0, { message: 'Rate must be ≥ 0' })
  rate!: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(28, { message: 'GST % must be between 0 and 28' })
  gstPercent?: number;
}

/** Create an invoice (Spec §5.8). Number is auto-assigned; starts as DRAFT. */
export class CreateInvoiceDto {
  @IsOptional()
  @IsUUID()
  clientOrgId?: string;

  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsISO8601()
  issueDate!: string;

  @IsOptional()
  @IsISO8601()
  dueDate?: string; // defaults to issueDate + payment terms

  @IsArray()
  @ArrayMinSize(1, { message: 'An invoice needs at least one line item' })
  @ValidateNested({ each: true })
  @Type(() => InvoiceLineDto)
  lines!: InvoiceLineDto[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}

/** Record a payment (Spec §5.8, §24: amount > 0 and ≤ remaining balance). */
export class CreatePaymentDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'Payment amount must be greater than 0' })
  amount!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  mode!: string;

  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}

export class ReversePaymentDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

export class CancelInvoiceDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}

/** Log an expense against a project (Spec §5.8). */
export class CreateExpenseDto {
  @IsUUID()
  projectId!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(60)
  category!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;

  @IsISO8601()
  spentAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsOptional()
  @IsUUID()
  receiptFileId?: string;
}

/** P&L / dues query window (Spec §5.8). */
export class FinanceRangeQuery {
  @IsOptional()
  @IsISO8601()
  from?: string;

  @IsOptional()
  @IsISO8601()
  to?: string;
}

/** Payroll month selector + lock/unlock (Spec §5.8, §25). */
export class PayrollMonthDto {
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  year!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}

export class UnlockMonthDto extends PayrollMonthDto {
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason!: string;
}
