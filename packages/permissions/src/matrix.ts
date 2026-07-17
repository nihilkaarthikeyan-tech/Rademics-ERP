/**
 * Role & Permission Matrix — SEED STATE (Spec §3, AUTHORITATIVE).
 *
 * Each capability maps to a 7-character string, one char per role in ROLE_ORDER:
 *   [ SUPER_ADMIN, HR, PM, TEAM_LEAD, EMPLOYEE, CLIENT, FINANCE ]
 * where:
 *   Y = allow, - = deny, S = scoped (own team / own projects / own record — §3 notes).
 *
 * This encoding lines up 1:1 with the §3 table so it can be audited by eye.
 * At runtime these seed grants are copied into the DB as capability-keys-against-roles
 * so Super Admin can adjust them without a code change (§3).
 */

import type { CapabilityKey } from './capabilities.js';
import { ROLE_ORDER, type Role } from './roles.js';

export const Grant = {
  ALLOW: 'ALLOW',
  DENY: 'DENY',
  SCOPED: 'SCOPED',
} as const;

export type Grant = (typeof Grant)[keyof typeof Grant];

const CHAR_TO_GRANT: Record<string, Grant> = {
  Y: Grant.ALLOW,
  '-': Grant.DENY,
  S: Grant.SCOPED,
};

/** Order: SA, HR, PM, TL, EMP, CLI, FIN — must match ROLE_ORDER. */
const SEED: Record<CapabilityKey, string> = {
  // — People & Organization —
  'people.employee.create_edit': 'YY-----',
  'people.employee.deactivate': 'YY-----',
  'people.roles.assign': 'Y------',
  'people.departments.manage': 'YY-----',
  'people.directory.view': 'YYYYY-Y',
  'people.salary.view_edit': 'YY----S',
  'people.freelancer.manage_contracts': 'YYS----',

  // — Attendance —
  'attendance.check_in_out': '-YYYY-Y',
  'attendance.own.view': 'YYYYY-Y',
  'attendance.team.view': 'YYSS---',
  'attendance.all.view': 'YY-----',
  'attendance.rules.configure': 'YY-----',
  'attendance.regularization.request': '-YYYY-Y',
  'attendance.regularization.approve': 'YYSS---',

  // — Projects & Tasks —
  'projects.create_edit': 'Y-Y----',
  'projects.archive_close': 'Y-S----',
  'tasks.create': 'Y-YS---',
  'tasks.assign': 'Y-YS---',
  'tasks.update_own_status': 'Y-YYY--',
  'tasks.review': 'Y-YS---',
  'tasks.comment': 'YYYYYSY',
  'projects.view_all': 'YYY---Y',
  'projects.view_own_team': '---SSS-',

  // — Files —
  'files.upload': 'Y-YYYS-',
  'files.mark_client_visible': 'Y-YS---',
  'files.delete_version': 'Y-S----',

  // — Client Portal —
  'portal.progress.view': '-----Y-',
  'portal.files.download': '-----Y-',
  'portal.deliverable.approve': '-----S-',
  'portal.invoices.view': '-----Y-',
  'portal.users.manage': 'Y------',

  // — Leave —
  'leave.request': '-YYYY-Y',
  'leave.approve_team': 'YYSS---',
  'leave.policy.configure': 'YY-----',
  'leave.calendar.view': 'YYYYY-Y',

  // — Finance —
  'finance.invoices.create_edit': 'Y-----Y',
  'finance.payments.record': 'Y-----Y',
  'finance.expenses.log': 'Y-S---Y',
  'finance.pnl.view': 'Y-----Y',
  'finance.payroll.export': 'YY----Y',

  // — Reports, AI & Admin —
  'reports.dashboard.view': 'YYYSS-Y',
  'ai.assistant.use': 'YYYYY-Y',
  'audit.log.view': 'Y------',
  'admin.settings.manage': 'Y------',
};

export type RoleGrants = Record<Role, Grant>;

/** Expanded matrix: capabilityKey -> { role -> Grant }. */
export const PERMISSION_MATRIX: Record<CapabilityKey, RoleGrants> = Object.fromEntries(
  (Object.entries(SEED) as [CapabilityKey, string][]).map(([key, encoded]) => {
    if (encoded.length !== ROLE_ORDER.length) {
      throw new Error(`Matrix seed for "${key}" has ${encoded.length} chars, expected ${ROLE_ORDER.length}`);
    }
    const grants = {} as RoleGrants;
    ROLE_ORDER.forEach((role, i) => {
      const ch = encoded[i]!;
      const grant = CHAR_TO_GRANT[ch];
      if (!grant) throw new Error(`Invalid grant char "${ch}" for "${key}" at position ${i}`);
      grants[role] = grant;
    });
    return [key, grants];
  }),
) as Record<CapabilityKey, RoleGrants>;
