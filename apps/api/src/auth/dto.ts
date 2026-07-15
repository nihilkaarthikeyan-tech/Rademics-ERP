import {
  IsEmail,
  IsEnum,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Role, ResourceType } from '@rademics/permissions';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  // Cloudflare Turnstile token (Spec §10 bot protection). Only enforced once
  // TURNSTILE_SECRET_KEY is configured server-side — see TurnstileService.
  @IsString()
  @IsOptional()
  captchaToken?: string;
}

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsOptional()
  captchaToken?: string;
}

export class SetPasswordDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  // Full strength validation (min length + must include a number) is in AuthService,
  // driven by the configurable Settings value (Spec §4, §5.1).
  @IsString()
  @MinLength(10)
  @MaxLength(200)
  password!: string;
}

export class InviteUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name!: string;

  @IsIn(Object.values(Role))
  role!: Role;

  @IsEnum(ResourceType)
  resourceType: ResourceType = ResourceType.INTERNAL;
}
