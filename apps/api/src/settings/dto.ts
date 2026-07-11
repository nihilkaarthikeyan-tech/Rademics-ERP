import { IsIn, IsObject, IsString } from 'class-validator';
import { Role } from '@rademics/permissions';
import { Grant } from '@prisma/client';

export class UpdateBusinessRulesDto {
  @IsObject()
  patch!: Record<string, unknown>;
}

export class UpdateRolePermissionDto {
  @IsIn(Object.values(Role))
  role!: Role;

  @IsString()
  capabilityKey!: string;

  @IsIn(Object.values(Grant))
  grant!: Grant;
}
