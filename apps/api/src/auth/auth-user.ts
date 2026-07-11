import type { Role, ResourceType } from '@rademics/permissions';

/** The authenticated principal attached to each request after JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  resourceType: ResourceType;
}
