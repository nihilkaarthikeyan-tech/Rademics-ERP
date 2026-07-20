import type { Role, ResourceType } from '@rademics/permissions';

/** The authenticated principal attached to each request after JwtAuthGuard. */
export interface AuthUser {
  id: string;
  email: string;
  role: Role;
  resourceType: ResourceType;
  // Desktop Agent rollout: true once this employee should check in via the
  // desktop app instead of the website. Same 15-min propagation delay as
  // role/resourceType, since it travels inside the access token (Spec §5.1 pattern).
  desktopCheckInRequired: boolean;
}
