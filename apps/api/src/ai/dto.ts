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

  /**
   * Prior turns, so "what about employees?" knows what it is following on from.
   * Sent by the client rather than stored server-side: the conversation lives in
   * the open tab, and nothing here is worth persisting beyond it. Trimmed hard —
   * this is context, not an archive.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  history?: { role: 'user' | 'assistant'; content: string }[];
}
