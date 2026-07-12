import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

const NAME_REGEX = /^[\p{L} .'-]+$/u;

// ── Internal-side client administration (portal.users.manage) ──
export class CreateClientOrgDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;
}

export class CreateClientUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Matches(NAME_REGEX)
  @MinLength(2)
  @MaxLength(150)
  name!: string;
}

export class GrantAccessDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  clientUserId!: string;

  @IsIn(['VIEWER', 'APPROVER'])
  level!: 'VIEWER' | 'APPROVER';
}

// ── Client-facing (portal) ──
export class RequestRevisionDto {
  @IsString()
  @MinLength(10, { message: 'Please explain what needs revising (at least 10 characters)' })
  @MaxLength(2000)
  comment!: string;
}

export class ApproveDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
