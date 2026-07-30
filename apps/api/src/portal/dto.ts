import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const NAME_REGEX = /^[\p{L} .'-]+$/u;

// ── Internal-side client administration (portal.users.manage) ──
export class CreateClientOrgDto {
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  // Billing identity. All optional: an unregistered (B2C) customer has no GSTIN,
  // and a reserved org is created before any of this is known. Where a GSTIN IS
  // given the service derives the state from it, because the first two characters
  // of a GSTIN are the registered state and the two cannot legitimately disagree.
  @IsOptional()
  @Matches(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{2}$/, {
    message: 'GSTIN must be 15 characters: 2 digits, 5 letters, 4 digits, a letter, then 2 more',
  })
  gstin?: string;

  @IsOptional()
  @Matches(/^[0-9]{2}$/, { message: 'State code must be two digits, e.g. 33 for Tamil Nadu' })
  stateCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  billingAddress?: string;
}

/** Same billing fields, for editing an org that already exists. */
export class UpdateClientOrgBillingDto {
  @IsOptional()
  @Matches(/^([0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{2})?$/, {
    message: 'GSTIN must be 15 characters: 2 digits, 5 letters, 4 digits, a letter, then 2 more',
  })
  gstin?: string;

  @IsOptional()
  @Matches(/^([0-9]{2})?$/, { message: 'State code must be two digits, e.g. 33 for Tamil Nadu' })
  stateCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  billingAddress?: string;
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

/**
 * One-step client onboarding (2026-07-27): name + email + which projects.
 *
 * The org is created behind this rather than asked for. It stays in the data
 * model because the portal refuses entry without one, invoices hang off it, and
 * deactivating it is the kill switch that ends portal access — but a Super
 * Admin onboarding a single contact should not have to think about it.
 */
export class OnboardClientDto {
  @IsString()
  @Matches(NAME_REGEX)
  @MinLength(2)
  @MaxLength(150)
  name!: string;

  @IsEmail()
  email!: string;

  /**
   * ClientOrg.number — the client ID reserved when the project was created
   * ("CL-008" → 8). Required, and it must be the reservation those projects
   * already hold: pairing both codes is what stops an account being attached
   * to the wrong client's work.
   */
  @IsInt()
  @IsPositive()
  clientNumber!: number;

  /** Project.number values (what "RAD-007" resolves to), not ids. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  projectNumbers!: number[];
}

/** No more Viewer/Approver level (2026-07-27) — a grant just IS the access. */
export class GrantAccessDto {
  @IsUUID()
  projectId!: string;

  @IsUUID()
  clientUserId!: string;
}
