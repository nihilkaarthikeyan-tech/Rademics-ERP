'use client';

import { PageGuide } from '@rademics/ui';
import { useMe } from '@/lib/me-context';
import { MyLeave } from '@/components/leave/my-leave';
import { LeaveApprovals } from '@/components/leave/leave-approvals';
import { TeamCalendar } from '@/components/leave/team-calendar';

// Who approves (leave.approve_team ALLOW/SCOPED) and who can request (leave.request).
const APPROVER_ROLES = ['SUPER_ADMIN', 'HR', 'TEAM_LEAD'];
const REQUEST_ROLES = ['HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'];

export default function LeavePage() {
  const me = useMe();
  const isApprover = APPROVER_ROLES.includes(me.role);
  const canRequest = REQUEST_ROLES.includes(me.role) && me.resourceType !== 'FREELANCE';

  return (
    <div className="mx-auto max-w-6xl">
      <div>
        <h1 className="text-xl font-semibold text-slate-800">Leave</h1>
        <p className="mt-1 text-sm text-slate-500">
          {isApprover
            ? 'Balances, requests, approvals & the team calendar'
            : 'Your balances, requests & team calendar'}
        </p>
      </div>

      <PageGuide
        id="leave"
        title="How leave works"
        className="mt-4"
        steps={[
          {
            label: 'Apply with dates and a reason',
            detail:
              'only working days count — Sundays and holidays inside your dates do not use up your balance.',
          },
          {
            label: 'Your team lead approves (HR if you have no lead)',
            detail: 'nobody can approve their own leave, and you are notified either way.',
          },
          {
            label: 'Approved leave appears on the team calendar',
            detail: 'so everyone can see who is away before planning work.',
          },
        ]}
        notes={[
          'Casual and Earned leave are credited automatically each month — you do not need to ask for them. Sick leave is given for the year up front.',
          'Asking for more days than you have is allowed: the extra days simply become unpaid leave, and the request tells you before you send it.',
          isApprover
            ? 'If you do not action a request within 48 hours it escalates automatically to the next level, and both you and the requester are told. You will also see a warning when a teammate is already off on the same dates.'
            : 'If your approver does not respond within 48 hours the request escalates on its own — you do not need to chase anyone.',
        ]}
      />

      {isApprover ? (
        <div className="mt-6">
          <LeaveApprovals />
        </div>
      ) : null}

      {canRequest ? (
        <div className="mt-8">
          {isApprover ? (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">My leave</h2>
          ) : null}
          <MyLeave />
        </div>
      ) : null}

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Team calendar</h2>
        <TeamCalendar />
      </div>
    </div>
  );
}
