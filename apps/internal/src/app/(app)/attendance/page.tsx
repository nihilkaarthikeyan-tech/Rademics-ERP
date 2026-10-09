'use client';

import { PageGuide } from '@rademics/ui';
import { useMe } from '@/lib/me-context';
import { TeamAttendance } from '@/components/attendance/team-attendance';
import { MyAttendance } from '@/components/attendance/my-attendance';

// Managers see the team/all view + approvals; check-in roles also see their own.
const MANAGER_ROLES = ['SUPER_ADMIN', 'HR', 'TEAM_LEAD'];
const SELF_ROLES = ['HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'];

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

      {/* The two questions this page gets asked: "where are the buttons?" (there
          are none — the desktop app owns check-in) and "my day is wrong, now
          what?" (regularization, which most people have never heard of). */}
      <PageGuide
        id="attendance"
        title="How attendance works"
        className="mt-4"
        steps={[
          {
            label: 'Check in from the Desktop Agent',
            detail:
              'the app on your computer records your hours. This page shows them; it has no check-in button.',
          },
          {
            label: 'Your day is worked out automatically',
            detail:
              'present, late (after 9:15), half day (under 4 hours) and overtime are calculated each night — nobody types them in.',
          },
          {
            label: 'Something recorded wrongly? Request a correction',
            detail:
              'power cut, forgot to check in, app was closed — send a correction with the real times and a reason.',
          },
        ]}
        notes={[
          isManager
            ? 'Corrections come to you for approval. Approving adds a corrective entry and recalculates that day — the original record is never erased, so the history stays honest.'
            : 'Your team lead (or HR) approves corrections. Approving recalculates that day; the original record is kept.',
        ]}
      />

      {isManager ? (
        <div className="mt-4">
          <TeamAttendance scope={scope} />
        </div>
      ) : null}

      {hasSelf ? (
        <div className="mt-8">
          {isManager ? (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
              My attendance
            </h2>
          ) : null}
          <MyAttendance />
        </div>
      ) : null}
    </div>
  );
}
