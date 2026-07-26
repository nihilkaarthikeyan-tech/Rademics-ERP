import { IsEmail, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

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

/** No more Viewer/Approver level (2026-07-27) — a grant just IS the access. */
export class GrantAccessDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  clientUserId!: string;
}
