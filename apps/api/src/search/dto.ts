import { IsString, MaxLength, MinLength } from 'class-validator';

export class SearchQuery {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  q!: string;
}
