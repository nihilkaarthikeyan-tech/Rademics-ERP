import { describe, it, expect } from 'vitest';
import { CAPABILITIES, CAPABILITY_KEYS } from './capabilities.js';
import { PERMISSION_MATRIX, Grant } from './matrix.js';
import { ROLE_ORDER, Role, ResourceType } from './roles.js';
import { resolveGrant, hasUnscopedCapability } from './index.js';

describe('Role & Permission Matrix (Spec §3)', () => {
  it('has exactly 42 capabilities across 8 groups', () => {
    expect(CAPABILITIES).toHaveLength(42);
    expect(new Set(CAPABILITY_KEYS).size).toBe(42); // no duplicate keys
  });

  it('has a grant for every capability × every role', () => {
    for (const key of CAPABILITY_KEYS) {
      const grants = PERMISSION_MATRIX[key];
      expect(grants, `missing grants for ${key}`).toBeDefined();
      for (const role of ROLE_ORDER) {
        expect(grants[role], `missing grant for ${key}/${role}`).toBeDefined();
      }
    }
  });

  // Spot-checks transcribed directly from the §3 table — the tricky cells.
  const cases: Array<[string, Role, Grant]> = [
    ['people.salary.view_edit', Role.FINANCE, Grant.SCOPED],
    ['people.salary.view_edit', Role.HR, Grant.ALLOW],
    ['people.salary.view_edit', Role.TEAM_LEAD, Grant.DENY],
    ['attendance.check_in_out', Role.SUPER_ADMIN, Grant.DENY],
    ['attendance.check_in_out', Role.FINANCE, Grant.ALLOW],
    ['attendance.team.view', Role.TEAM_LEAD, Grant.SCOPED],
    ['tasks.comment', Role.CLIENT, Grant.SCOPED],
    ['tasks.update_own_status', Role.CLIENT, Grant.DENY],
    ['files.upload', Role.CLIENT, Grant.SCOPED],
    ['projects.view_own_team', Role.TEAM_LEAD, Grant.SCOPED],
    // The client has no approval power left (2026-07-27) — view + request-status only.
    ['portal.progress.view', Role.CLIENT, Grant.ALLOW],
    ['reports.dashboard.view', Role.TEAM_LEAD, Grant.SCOPED],
    ['audit.log.view', Role.SUPER_ADMIN, Grant.ALLOW],
    ['audit.log.view', Role.HR, Grant.DENY],
    ['admin.settings.manage', Role.SUPER_ADMIN, Grant.ALLOW],

    // PM role removed (2026-07-25): HR now runs projects company-wide.
    ['projects.create_edit', Role.HR, Grant.ALLOW],
    ['tasks.create', Role.HR, Grant.ALLOW],
    ['tasks.assign', Role.HR, Grant.ALLOW],
    ['tasks.review', Role.HR, Grant.ALLOW],
    ['files.upload', Role.HR, Grant.ALLOW],
    // ...but people-powers stay on reporting lines, and money stays with Finance.
    ['finance.expenses.log', Role.HR, Grant.DENY],
    ['leave.approve_team', Role.TEAM_LEAD, Grant.SCOPED],
    // Nobody but Super Admin may hand out roles.
    ['people.roles.assign', Role.HR, Grant.DENY],
  ];

  it.each(cases)('%s / %s = %s', (key, role, expected) => {
    expect(PERMISSION_MATRIX[key as keyof typeof PERMISSION_MATRIX][role]).toBe(expected);
  });

  it('has exactly six roles — PM is an appointment, not a role (2026-07-25)', () => {
    expect(ROLE_ORDER).toHaveLength(6);
    expect(ROLE_ORDER).not.toContain('PM');
    expect(Object.keys(Role)).not.toContain('PM');
  });

  it('every seed row has one grant per role', () => {
    // Guards the 7→6 column drop: a stale 7-char row would silently shift every
    // grant after the removed PM column onto the wrong role.
    for (const key of CAPABILITY_KEYS) {
      expect(Object.keys(PERMISSION_MATRIX[key]), key).toHaveLength(6);
    }
  });

  it('Super Admin can never check in/out (self) — §3', () => {
    expect(
      resolveGrant(Role.SUPER_ADMIN, ResourceType.INTERNAL, 'attendance.check_in_out'),
    ).toBe(Grant.DENY);
  });
});

describe('Freelancer rule (§3): Employee column minus Attendance & Leave', () => {
  const freelancer = { role: Role.EMPLOYEE, resourceType: ResourceType.FREELANCE };
  const employee = { role: Role.EMPLOYEE, resourceType: ResourceType.INTERNAL };

  it('strips attendance for freelancers but keeps it for internal employees', () => {
    expect(hasUnscopedCapability(employee, 'attendance.check_in_out')).toBe(true);
    expect(hasUnscopedCapability(freelancer, 'attendance.check_in_out')).toBe(false);
    expect(resolveGrant(freelancer.role, freelancer.resourceType, 'attendance.own.view')).toBe(
      Grant.DENY,
    );
  });

  it('strips leave for freelancers', () => {
    expect(hasUnscopedCapability(employee, 'leave.request')).toBe(true);
    expect(hasUnscopedCapability(freelancer, 'leave.request')).toBe(false);
  });

  it('keeps non-attendance/leave employee capabilities for freelancers', () => {
    // Employee can comment on tasks and update own task status — freelancers keep these.
    expect(hasUnscopedCapability(freelancer, 'tasks.comment')).toBe(true);
    expect(hasUnscopedCapability(freelancer, 'tasks.update_own_status')).toBe(true);
  });
});
