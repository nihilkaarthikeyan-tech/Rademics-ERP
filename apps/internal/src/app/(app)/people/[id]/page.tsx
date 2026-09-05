'use client';

import { Suspense, use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Label, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';

interface Option {
  id: string;
  name: string;
}

interface Employee {
  id: string;
  email: string;
  name: string;
  role: string;
  resourceType: string;
  status: string;
  employmentStatus: string | null;
  phone: string | null;
  employeeCode: string | null;
  joinDate: string | null;
  department: Option | null;
  team: Option | null;
  reportingManager: (Option & { email: string }) | null;
  skills: Option[];
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'slate'> = {
  ACTIVE: 'green',
  INVITED: 'amber',
  DEACTIVATED: 'slate',
};

/** Staff roles assignable here — CLIENT accounts are made via client onboarding. */
const ASSIGNABLE_ROLES = ['SUPER_ADMIN', 'HR', 'TEAM_LEAD', 'EMPLOYEE', 'FINANCE'];
const CAN_EDIT = ['SUPER_ADMIN', 'HR'];

const selectClass =
  'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

export default function EmployeeDetailPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingState />}>
      <EmployeeDetail_ {...props} />
    </Suspense>
  );
}

function EmployeeDetail_({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const [emp, setEmp] = useState<Employee | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [departments, setDepartments] = useState<Option[]>([]);
  const [teams, setTeams] = useState<Option[]>([]);
  const [managers, setManagers] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Edit-form state, filled from the loaded employee.
  const [form, setForm] = useState({
    name: '',
    phone: '',
    departmentId: '',
    teamId: '',
    reportingManagerId: '',
    employmentStatus: 'ACTIVE',
    joinDate: '',
  });
  const [rolePick, setRolePick] = useState('');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const e = await apiFetch<Employee>(`/employees/${id}`);
      setEmp(e);
      setForm({
        name: e.name,
        phone: e.phone ?? '',
        departmentId: e.department?.id ?? '',
        teamId: e.team?.id ?? '',
        reportingManagerId: e.reportingManager?.id ?? '',
        employmentStatus: e.employmentStatus ?? 'ACTIVE',
        joinDate: e.joinDate ? e.joinDate.slice(0, 10) : '',
      });
      setRolePick(e.role);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [id]);

  useEffect(() => {
    void load();
    apiFetch<Option[]>('/departments').then(setDepartments).catch(() => undefined);
    apiFetch<Option[]>('/teams').then(setTeams).catch(() => undefined);
    // Manager candidates: the staff directory (first 100 by name).
    apiFetch<{ items: (Option & { role: string })[] }>('/employees?pageSize=100')
      .then((r) => setManagers(r.items.filter((m) => m.id !== id)))
      .catch(() => undefined);
  }, [load, id]);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/employees/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: form.name.trim(),
          phone: form.phone || undefined,
          departmentId: form.departmentId || undefined,
          teamId: form.teamId || undefined,
          reportingManagerId: form.reportingManagerId || undefined,
          employmentStatus: form.employmentStatus,
          joinDate: form.joinDate || undefined,
        }),
      });
      setNotice('Profile saved.');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save the profile');
    } finally {
      setBusy(false);
    }
  }

  async function changeRole() {
    if (!emp || rolePick === emp.role) return;
    const sure = window.confirm(
      `Change ${emp.name}'s role from ${emp.role} to ${rolePick}? They are logged out everywhere and get the new access at next login.`,
    );
    if (!sure) {
      setRolePick(emp.role);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/employees/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role: rolePick }) });
      setNotice(`Role changed to ${rolePick}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change the role');
      setRolePick(emp.role);
    } finally {
      setBusy(false);
    }
  }

  async function deactivate() {
    if (!emp) return;
    const sure = window.confirm(
      `Deactivate ${emp.name}? They are logged out immediately and can no longer sign in. Their open tasks return to the assignment pool and the project managers are notified. This is how someone leaves the company.`,
    );
    if (!sure) return;
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch<{ tasksReassigned?: number }>(`/employees/${id}/deactivate`, {
        method: 'POST',
        body: '{}',
      });
      setNotice(
        `Deactivated.${r.tasksReassigned ? ` ${r.tasksReassigned} open task(s) returned to the pool for reassignment.` : ''}`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not deactivate');
    } finally {
      setBusy(false);
    }
  }

  async function resendInvite() {
    if (!emp) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch(`/employees/${id}/resend-invite`, { method: 'POST', body: '{}' });
      setNotice(`Invite re-sent to ${emp.email}. The previous link no longer works.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not re-send the invite');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') return <LoadingState />;
  if (state === 'error' || !emp) {
    return (
      <div className="mx-auto max-w-2xl">
        <p className="text-sm text-slate-500">Could not load this person.</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => void load()}>
          Try again
        </Button>
      </div>
    );
  }

  const canEdit = CAN_EDIT.includes(me.role);
  const canRole = me.role === 'SUPER_ADMIN' && emp.id !== me.id && emp.role !== 'CLIENT';
  const deactivated = emp.status === 'DEACTIVATED';

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/people" className="text-sm text-slate-500 hover:text-slate-800">
        ← Back to People
      </Link>

      {/* Identity header */}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#7C6CF6] to-[#A855F7] text-base font-semibold text-white">
          {emp.name
            .split(/\s+/)
            .slice(0, 2)
            .map((p) => p[0])
            .join('')
            .toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-800">{emp.name}</h1>
          <p className="text-sm text-slate-500">
            {emp.email}
            {emp.employeeCode ? ` · ${emp.employeeCode}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <Badge tone={STATUS_TONE[emp.status] ?? 'slate'}>{emp.status}</Badge>
          <Badge tone="slate">{emp.role}</Badge>
          {emp.resourceType === 'FREELANCE' ? <Badge tone="blue">Freelance</Badge> : null}
        </div>
      </div>

      {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm font-medium text-emerald-700">{notice}</p> : null}

      {emp.status === 'INVITED' && canEdit ? (
        <Card className="mt-4">
          <CardContent className="pt-5">
            <p className="text-sm text-slate-600">
              This person has not set their password yet, so they cannot sign in. If the invite
              never reached them, send it again — the old link stops working.
            </p>
            <Button className="mt-3" variant="outline" onClick={resendInvite} disabled={busy}>
              {busy ? 'Sending…' : 'Re-send invite email'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {deactivated ? (
        <Card className="mt-4">
          <CardContent className="pt-5">
            <p className="text-sm text-slate-600">
              This account is deactivated — they can no longer sign in, and their history stays on record.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Profile */}
      {canEdit && !deactivated ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={saveProfile} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="e-name">Full name</Label>
                  <Input id="e-name" value={form.name} onChange={(e) => set('name', e.target.value)} required minLength={2} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="e-phone">Phone</Label>
                  <Input id="e-phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="10–15 digits" />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="e-dept">Department</Label>
                  <select id="e-dept" className={selectClass} value={form.departmentId} onChange={(e) => set('departmentId', e.target.value)}>
                    <option value="">None</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="e-team">Team</Label>
                  <select id="e-team" className={selectClass} value={form.teamId} onChange={(e) => set('teamId', e.target.value)}>
                    <option value="">None</option>
                    {teams.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="e-mgr">Reporting manager</Label>
                  <select id="e-mgr" className={selectClass} value={form.reportingManagerId} onChange={(e) => set('reportingManagerId', e.target.value)}>
                    <option value="">Nobody</option>
                    {managers.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="e-emp">Employment status</Label>
                  <select id="e-emp" className={selectClass} value={form.employmentStatus} onChange={(e) => set('employmentStatus', e.target.value)}>
                    <option value="ACTIVE">Active</option>
                    <option value="ON_NOTICE">On notice</option>
                    <option value="EXITED">Exited</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="e-join">Join date</Label>
                  <Input id="e-join" type="date" value={form.joinDate} onChange={(e) => set('joinDate', e.target.value)} />
                </div>
              </div>
              <div className="flex justify-end">
                <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}

      {/* Role — Super Admin only, own endpoint, audited */}
      {canRole && !deactivated ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Role</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex w-56 flex-col gap-1.5">
                <Label htmlFor="e-role">Access role</Label>
                <select id="e-role" className={selectClass} value={rolePick} onChange={(e) => setRolePick(e.target.value)}>
                  {ASSIGNABLE_ROLES.map((r) => (
                    <option key={r} value={r}>{r.replace('_', ' ')}</option>
                  ))}
                </select>
              </div>
              <Button disabled={busy || rolePick === emp.role} onClick={() => void changeRole()}>
                Change role
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Changing a role logs the person out everywhere; the new access applies when they sign back in.
              Every change is recorded in the audit log.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Offboarding */}
      {canEdit && !deactivated ? (
        <Card className="mt-4 border-rose-100">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
            <div>
              <p className="text-sm font-semibold text-slate-800">Deactivate this account</p>
              <p className="mt-0.5 text-xs text-slate-500">
                For someone leaving the company: sign-in blocked immediately, open tasks return to the pool,
                history and records stay intact.
              </p>
            </div>
            <Button variant="outline" disabled={busy} onClick={() => void deactivate()} className="border-rose-200 text-rose-600 hover:bg-rose-50">
              Deactivate…
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
