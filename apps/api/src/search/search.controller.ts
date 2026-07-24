import { Controller, Get, Query } from '@nestjs/common';
import { SearchService, type SearchResults } from './search.service';
import { SearchQuery } from './dto';
import { CurrentUser } from '../auth/decorators';
import type { AuthUser } from '../auth/auth-user';

@Controller('search')
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  get(@Query() query: SearchQuery, @CurrentUser() user: AuthUser): Promise<SearchResults> {
    return this.search.search(query.q, user);
  }
}
