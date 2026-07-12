import { IsIn, IsString, MaxLength } from 'class-validator';

const GROUPS = ['tasks', 'leave', 'attendance', 'invoices', 'mentions', 'files'];

export class SetPreferenceDto {
  @IsString()
  @IsIn(GROUPS)
  eventGroup!: string;

  @IsIn(['IN_APP', 'IN_APP_EMAIL', 'MUTE'])
  pref!: 'IN_APP' | 'IN_APP_EMAIL' | 'MUTE';
}

export class MarkReadDto {
  @IsString()
  @MaxLength(64)
  id!: string;
}
