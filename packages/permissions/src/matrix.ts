/**
 * Role & Permission Matrix — SEED STATE (Spec §3, AUTHORITATIVE).
 *
 * Each capability maps to a 6-character string, one char per role in ROLE_ORDER:
 *   [ SUPER_ADMIN, HR, TEAM_LEAD, EMPLOYEE, CLIENT, FINANCE ]
 * where:
 *   Y = allow, - = deny, S = scoped (own team / own projects / own record — §3 notes).
 *
 * This encoding lines up 1:1 with the §3 table so it can be audited by eye.
 * At runtime these seed grants are copied into the DB as capability-keys-against-roles
 * so Super Admin can adjust them without a code change (§3).
 *
 * PM was removed as a role on 2026-07-25. Its project/task powers moved to HR
 * (who, with Super Admin, now runs projects), EXCEPT the ones that are genuinely
 * per-project — those are granted by APPOINTMENT instead: whoever sits in a
 * project's `pmId` gets tasks.create / tasks.assign / tasks.review /
 * files.mark_client_visible / files.delete_version / finance.expenses.log and
 * edit+close on THAT project only. That check lives in the services (see
 * `assertProjectAuthority`), not here, because this table is keyed by role and
 * an appointment is not a role.
 *
 * Deliberately NOT transferred to the appointment: leave.approve_team,
 * attendance.team.view and attendance.regularization.approve follow reporting
 * lines, not projects — managing a project must never grant HR powers over
 * people you don't manage.
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

/** Order: SA, HR, TL, EMP, CLI, FIN — must match ROLE_ORDER. */
const SEED: Record<CapabilityKey, string> = {
  // — People & Organization —
  'people.employee.create_edit': 'YY----',
  'people.employee.deactivate': 'YY----',
  'people.roles.assign': 'Y-----',
  'people.departments.manage': 'YY----',
  'people.directory.view': 'YYYY-Y',
  'people.salary.view_edit': 'YY---S',
  // Contracts/NDAs are company legal documents, not project material — they stay
  // with HR/SA and are NOT part of the project appointment.
  'people.freelancer.manage_contracts': 'YY----',

  // — Attendance —
  'attendance.check_in_out': '-YYY-Y',
  'attendance.own.view': 'YYYY-Y',
  'attendance.team.view': 'YYS---',
  'attendance.all.view': 'YY----',
  'attendance.rules.configure': 'YY----',
  'attendance.regularization.request': '-YYY-Y',
  'attendance.regularization.approve': 'YYS---',

  // — Projects & Tasks —
  // Creating a project is company-level and cannot be project-scoped; the
  // appointed manager edits/closes their own project via assertProjectAuthority.
  'projects.create_edit': 'YY----',
  'projects.archive_close': 'YY----',
  'tasks.create': 'YYS---',
  'tasks.assign': 'YYS---',
  'tasks.update_own_status': 'Y-YY--',
  'tasks.review': 'YYS---',
  'tasks.comment': 'YYYYSY',
  'projects.view_all': 'YY---Y',
  'projects.view_own_team': '--SSS-',

  // — Files —
  'files.upload': 'YYYYS-',
  'files.mark_client_visible': 'YYS---',
  'files.delete_version': 'YY----',

  // — Client Portal —
  'portal.progress.view': '----Y-',
  'portal.files.download': '----Y-',
  'portal.deliverable.approve': '----S-',
  'portal.invoices.view': '----Y-',
  'portal.users.manage': 'Y-----',

  // — Leave —
  'leave.request': '-YYY-Y',
  'leave.approve_team': 'YYS---',
  'leave.policy.configure': 'YY----',
  'leave.calendar.view': 'YYYY-Y',

  // — Finance —
  'finance.invoices.create_edit': 'Y----Y',
  'finance.payments.record': 'Y----Y',
  'finance.expenses.log': 'Y----Y',
  'finance.pnl.view': 'Y----Y',
  'finance.payroll.export': 'YY---Y',

  // — Reports, AI & Admin —
  'reports.dashboard.view': 'YYSS-Y',
  'ai.assistant.use': 'YYYY-Y',
  'audit.log.view': 'Y-----',
  'admin.settings.manage': 'Y-----',
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
