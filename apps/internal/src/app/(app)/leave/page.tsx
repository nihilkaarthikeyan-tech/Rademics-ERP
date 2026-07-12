'use client';

import { useMe } from '@/lib/me-context';
import { MyLeave } from '@/components/leave/my-leave';
import { LeaveApprovals } from '@/components/leave/leave-approvals';
import { TeamCalendar } from '@/components/leave/team-calendar';

// Who approves (leave.approve_team ALLOW/SCOPED) and who can request (leave.request).
const APPROVER_ROLES = ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD'];
const REQUEST_ROLES = ['HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'];

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

      {isApprover ? (
        <div className="mt-4">
          <LeaveApprovals />
        </div>
      ) : null}

      {canRequest ? (
        <div className="mt-8">
          {isApprover ? (
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">My leave</h2>
          ) : null}
          <MyLeave />
        </div>
      ) : null}

      <div className="mt-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Team calendar</h2>
        <TeamCalendar />
      </div>
    </div>
  );
}
