/**
 * Project reference code — the human-facing handle for a project (RAD-001).
 *
 * Why this exists: a Super Admin points a client at a project by typing this
 * code, so the same string must be produced and understood identically by the
 * API and both front-ends. Formatting it in three places invites drift, and a
 * drift here silently grants the wrong client the wrong project.
 *
 * The stored value is `Project.number` (an integer from a Postgres sequence).
 * The code is a rendering of it, never a separate stored field — so it cannot
 * disagree with the number it refers to.
 */

export const PROJECT_CODE_PREFIX = 'RAD';

/** Minimum digits; numbers past 999 simply get longer (RAD-1000), never truncated. */
const PAD = 3;

/** 7 → "RAD-007". */
export function formatProjectCode(projectNumber: number): string {
  return `${PROJECT_CODE_PREFIX}-${String(projectNumber).padStart(PAD, '0')}`;
}

/**
 * Parse what a human typed into a project number, or null if it isn't one.
 *
 * Deliberately forgiving about the things people actually do — lowercase,
 * surrounding spaces, a missing prefix, extra leading zeros ("rad-7", "7",
 * "RAD-0007" all mean 7) — because the confirmation step shows the resolved
 * project name back before anything is saved, so a lenient parse cannot by
 * itself cause a wrong grant. It is NOT forgiving about trailing junk
 * ("7abc"), which signals a typo rather than a formatting preference.
 */
export function parseProjectCode(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const match = /^(?:RAD[\s-]*)?(\d{1,9})$/i.exec(trimmed);
  if (!match) return null;

  const parsed = Number(match[1]);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
