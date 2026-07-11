import type { Request } from 'express';

/** Extract audit metadata (IP, user-agent) from the request (Spec §5.10). */
export function reqMeta(req: Request): { ip?: string | null; userAgent?: string | null } {
  return { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null };
}
