import { describe, it, expect } from 'vitest';
import { CAPABILITIES, CAPABILITY_KEYS } from './capabilities.js';
import { PERMISSION_MATRIX, Grant } from './matrix.js';
import { ROLE_ORDER, Role, ResourceType } from './roles.js';
import { resolveGrant, hasUnscopedCapability } from './index.js';

describe('Role & Permission Matrix (Spec §3)', () => {
  it('has exactly 44 capabilities across 8 groups', () => {
    expect(CAPABILITIES).toHaveLength(44);
    expect(new Set(CAPABILITY_KEYS).size).toBe(44); // no duplicate keys
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
    ['people.salary.view_edit', Role.PM, Grant.DENY],
    ['attendance.check_in_out', Role.SUPER_ADMIN, Grant.DENY],
    ['attendance.check_in_out', Role.FINANCE, Grant.ALLOW],
    ['attendance.team.view', Role.PM, Grant.SCOPED],
    ['tasks.comment', Role.CLIENT, Grant.SCOPED],
    ['tasks.update_own_status', Role.CLIENT, Grant.DENY],
    ['files.upload', Role.CLIENT, Grant.SCOPED],
    ['files.upload', Role.HR, Grant.DENY],
    ['projects.view_own_team', Role.TEAM_LEAD, Grant.SCOPED],
    ['portal.deliverable.approve', Role.CLIENT, Grant.SCOPED],
    ['finance.expenses.log', Role.PM, Grant.SCOPED],
    ['reports.dashboard.view', Role.TEAM_LEAD, Grant.SCOPED],
    ['audit.log.view', Role.SUPER_ADMIN, Grant.ALLOW],
    ['audit.log.view', Role.HR, Grant.DENY],
    ['admin.settings.manage', Role.SUPER_ADMIN, Grant.ALLOW],
  ];

  it.each(cases)('%s / %s = %s', (key, role, expected) => {
    expect(PERMISSION_MATRIX[key as keyof typeof PERMISSION_MATRIX][role]).toBe(expected);
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
