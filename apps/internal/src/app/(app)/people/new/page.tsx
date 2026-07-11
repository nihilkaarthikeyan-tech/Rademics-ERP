'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, CardContent, Input, Label } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

interface Option {
  id: string;
  name: string;
}

const ROLES = ['SUPER_ADMIN', 'HR', 'PM', 'TEAM_LEAD', 'EMPLOYEE', 'CLIENT', 'FINANCE'];

export default function NewEmployeePage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Option[]>([]);
  const [teams, setTeams] = useState<Option[]>([]);
  const [form, setForm] = useState({
    email: '',
    name: '',
    role: 'EMPLOYEE',
    resourceType: 'INTERNAL',
    departmentId: '',
    teamId: '',
    phone: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiFetch<Option[]>('/departments').then(setDepartments).catch(() => undefined);
    apiFetch<{ id: string; name: string }[]>('/teams').then(setTeams).catch(() => undefined);
  }, []);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch('/employees', {
        method: 'POST',
        body: JSON.stringify({
          email: form.email,
          name: form.name,
          role: form.role,
          resourceType: form.resourceType,
          departmentId: form.departmentId || undefined,
          teamId: form.teamId || undefined,
          phone: form.phone || undefined,
        }),
      });
      router.push('/people');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create employee');
    } finally {
      setSaving(false);
    }
  }

  const selectClass =
    'flex h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent';

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4">
        <Link href="/people" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to People
        </Link>
      </div>
      <h1 className="text-xl font-semibold text-slate-800">Add employee</h1>
      <p className="mt-1 text-sm text-slate-500">
        The person receives an email invite to set their password.
      </p>

      <Card className="mt-4">
        <CardContent className="pt-6">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Full name</Label>
              <Input id="name" value={form.name} onChange={(e) => set('name', e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="role">Role</Label>
                <select id="role" className={selectClass} value={form.role} onChange={(e) => set('role', e.target.value)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="resourceType">Resource type</Label>
                <select
                  id="resourceType"
                  className={selectClass}
                  value={form.resourceType}
                  onChange={(e) => set('resourceType', e.target.value)}
                >
                  <option value="INTERNAL">Internal</option>
                  <option value="FREELANCE">Freelance</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="department">Department</Label>
                <select
                  id="department"
                  className={selectClass}
                  value={form.departmentId}
                  onChange={(e) => set('departmentId', e.target.value)}
                >
                  <option value="">—</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="team">Team</Label>
                <select
                  id="team"
                  className={selectClass}
                  value={form.teamId}
                  onChange={(e) => set('teamId', e.target.value)}
                >
                  <option value="">—</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">Phone (optional)</Label>
              <Input id="phone" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
            </div>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <div className="flex gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? 'Creating…' : 'Create & send invite'}
              </Button>
              <Link href="/people">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
