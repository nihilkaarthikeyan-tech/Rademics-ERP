import { ArrayMaxSize, IsArray, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class DailySummaryDto {
  @IsUUID()
  teamId!: string;
}

export class AssignmentSuggestionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUUID('4', { each: true })
  skillIds?: string[];
}

export class ChatDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  question!: string;
}
