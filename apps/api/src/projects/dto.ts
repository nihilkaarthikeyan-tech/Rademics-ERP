import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsIn,
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
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProjectType, ProjectStatus, TaskPriority } from '@prisma/client';
import { TaskAction } from '@rademics/types';

export class CreateProjectDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsEnum(ProjectType)
  type: ProjectType = ProjectType.PROJECT;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  pmId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cadence?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsUUID()
  pmId?: string;

  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsISO8601()
  startDate?: string;

  @IsOptional()
  @IsISO8601()
  endDate?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetAmount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  cadence?: string;
}

export class CreateModuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  position?: number;
}

export class CreateTaskDto {
  @IsUUID()
  projectId!: string;

  @IsOptional()
  @IsUUID()
  moduleId?: string;

  @IsOptional()
  @IsUUID()
  parentTaskId?: string; // present => this is a subtask (one level only, §24)

  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(999)
  estimatedHours?: number; // quarter-hour step checked in service (§24)

  @IsOptional()
  @IsISO8601()
  deadline?: string;

  @IsOptional()
  @IsBoolean()
  clientFacing?: boolean;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsUUID()
  moduleId?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @IsNumber()
  @Min(0.25)
  @Max(999)
  estimatedHours?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(999)
  actualHours?: number;

  @IsOptional()
  @IsISO8601()
  deadline?: string;

  @IsOptional()
  @IsBoolean()
  clientFacing?: boolean;
}

/** Assign / reassign target (Spec §6 Assign, Reassign). */
export class AssignTaskDto {
  @IsUUID()
  assigneeId!: string;
}

/** Perform a §6 state-machine transition. */
export class TransitionDto {
  @IsEnum(TaskAction)
  action!: TaskAction;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string; // mandatory for SEND_BACK / CLIENT_REQUEST_REVISION / CANCEL (§6)
}

export class CreateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  clientVisible?: boolean;

  @IsOptional()
  @IsArray()
  @IsUUID('all', { each: true })
  mentionUserIds?: string[];
}

export class ChecklistItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;
}

export class ListTasksQuery {
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsIn([
    'DRAFT', 'ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'SUBMITTED_FOR_REVIEW',
    'CLIENT_REVIEW', 'COMPLETED', 'INVOICED', 'CLOSED', 'CANCELLED',
  ])
  status?: string;

  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 100;
}
