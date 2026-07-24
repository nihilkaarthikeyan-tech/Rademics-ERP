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
  // Min 1, not 3: "hi" must reach the service's greeting handler, not bounce
  // off validation with a raw "must be longer than 3 characters" in the chat.
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  question!: string;
}
