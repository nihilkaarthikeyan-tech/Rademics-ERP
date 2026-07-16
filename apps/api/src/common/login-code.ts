import { randomInt } from 'node:crypto';

/**
 * Anonymized login/display codes for the double-blind client↔worker boundary.
 *
 * Format: `RDM-XXXXXX` — six chars from a Crockford-style alphabet that drops the
 * ambiguous ones (no 0/O, 1/I/L) so a code read over the phone can't be mistyped.
 * 32^6 ≈ 1.07B combinations: not enumerable, and collisions are vanishingly rare
 * (the DB `@unique` on `loginCode` is the final guard — we retry on the off chance).
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // 31 chars, no 0 O 1 I L
const CODE_LEN = 6;
export const LOGIN_CODE_PREFIX = 'RDM-';

/** True for a syntactically valid login code (used to route login by code vs email). */
export function isLoginCode(value: string): boolean {
  return new RegExp(`^${LOGIN_CODE_PREFIX}[${ALPHABET}]{${CODE_LEN}}$`).test(value.trim().toUpperCase());
}

/** Generate one candidate code. Uniqueness is enforced by the caller against the DB. */
export function generateLoginCode(): string {
  let body = '';
  for (let i = 0; i < CODE_LEN; i++) body += ALPHABET[randomInt(ALPHABET.length)];
  return `${LOGIN_CODE_PREFIX}${body}`;
}

/**
 * The handle one side sees for the other, derived from the target's role.
 * Employees see a client as "Client #XXXXXX"; clients see a worker as "Worker #XXXXXX".
 * Falls back to a neutral "#XXXXXX" if the role is unexpected.
 */
export function anonymizedHandle(loginCode: string, targetRole: string): string {
  const short = loginCode.startsWith(LOGIN_CODE_PREFIX) ? loginCode.slice(LOGIN_CODE_PREFIX.length) : loginCode;
  const label = targetRole === 'CLIENT' ? 'Client' : targetRole === 'EMPLOYEE' ? 'Worker' : '';
  return label ? `${label} #${short}` : `#${short}`;
}

/**
 * Who may see real names/emails across the client↔worker boundary. Brokers/management
 * (Super Admin, HR, PM, Finance) connect the two sides, so they see everyone's real
 * identity. The delivery/consumer side (Employee, Team Lead, Client) only ever sees
 * anonymized handles of the other party. Unknown roles fail closed (anonymized).
 */
const IDENTITY_BROKER_ROLES = new Set(['SUPER_ADMIN', 'HR', 'PM', 'FINANCE']);
export function canSeeRealIdentity(viewerRole: string): boolean {
  return IDENTITY_BROKER_ROLES.has(viewerRole);
}
