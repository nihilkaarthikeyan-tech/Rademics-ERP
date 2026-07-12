'use client';

import { useMe } from '@/lib/me-context';
import { TeamAttendance } from '@/components/attendance/team-attendance';
import { MyAttendance } from '@/components/attendance/my-attendance';

// Managers see the team/all view + approvals; check-in roles also see their own.
const MANAGER_ROLES = ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD'];
const SELF_ROLES = ['HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'];

export default function AttendancePage() {
  const me = useMe();
  const isManager = MANAGER_ROLES.includes(me.role);
  const hasSelf = SELF_ROLES.includes(me.role);
  const scope: 'all' | 'team' = me.role === 'SUPER_ADMIN' || me.role === 'HR' ? 'all' : 'team';

  return (
    <div className="mx-auto max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Attendance</h1>
        <p className="mt-1 text-sm text-slate-500">
          {isManager
            ? `${scope === 'all' ? 'Everyone' : 'Your team'} · live presence, records & approvals`
            : 'Your attendance & regularization requests'}
        </p>
      </div>

      {isManager ? (
        <div className="mt-4">
          <TeamAttendance scope={scope} />
        </div>
      ) : null}

      {hasSelf ? (
        <div className="mt-8">
          {isManager ? (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">
              My attendance
            </h2>
          ) : null}
          <MyAttendance />
        </div>
      ) : null}
    </div>
  );
}
