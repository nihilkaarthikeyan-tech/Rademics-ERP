import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Role, ResourceType } from '@rademics/permissions';
import { BusinessVertical, EmploymentStatus } from '@prisma/client';

// §24: name 2–150, letters/spaces/.'- only.
const NAME_REGEX = /^[\p{L} .'-]+$/u;

export class CreateDepartmentDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsEnum(BusinessVertical)
  vertical!: BusinessVertical;
}

export class CreateTeamDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsUUID()
  departmentId!: string;

  @IsOptional()
  @IsUUID()
  teamLeadId?: string;
}

export class CreateSkillTagDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name!: string;
}

export class CreateEmployeeDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(NAME_REGEX, { message: 'Name may contain only letters, spaces, . \' -' })
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @IsIn(Object.values(Role))
  role!: Role;

  @IsEnum(ResourceType)
  resourceType: ResourceType = ResourceType.INTERNAL;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsUUID()
  reportingManagerId?: string;

  @IsOptional()
  @Matches(/^\d{10,15}$/, { message: 'Phone must be 10–15 digits' })
  phone?: string;

  @IsOptional()
  @IsString()
  joinDate?: string; // ISO date; not-in-future checked in service

  @IsOptional()
  @IsString()
  @MaxLength(40)
  employeeCode?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  skillIds?: string[];
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @Matches(NAME_REGEX)
  @MinLength(2)
  @MaxLength(150)
  name?: string;

  @IsOptional()
  @Matches(/^\d{10,15}$/)
  phone?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsUUID()
  reportingManagerId?: string;

  @IsOptional()
  @IsEnum(EmploymentStatus)
  employmentStatus?: EmploymentStatus;

  @IsOptional()
  @IsString()
  joinDate?: string;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  skillIds?: string[];

  // Desktop Agent rollout: HR/Admin flips this once an employee is onboarded onto
  // the desktop app, hiding the website's check-in button for them.
  @IsOptional()
  @IsBoolean()
  desktopCheckInRequired?: boolean;
}

export class SetSalaryDto {
  // Stored encrypted at rest (Spec §10). Sent as a string; free-form (amount).
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  salary!: string;
}

export class ListEmployeesQuery {
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
  pageSize = 25;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  departmentId?: string;

  @IsOptional()
  @IsUUID()
  teamId?: string;

  @IsOptional()
  @IsIn(Object.values(Role))
  role?: Role;

  @IsOptional()
  @IsEnum(ResourceType)
  resourceType?: ResourceType;
}
