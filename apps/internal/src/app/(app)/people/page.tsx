'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Badge, Button, Card, EmptyState, ErrorState, Input, LoadingState } from '@rademics/ui';
import { apiFetch } from '@/lib/api';

interface EmployeeRow {
  id: string;
  name: string;
  email: string;
  role: string;
  resourceType: string;
  status: string;
  department: { id: string; name: string } | null;
  team: { id: string; name: string } | null;
}

interface ListResp {
  items: EmployeeRow[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_TONE: Record<string, 'green' | 'amber' | 'slate'> = {
  ACTIVE: 'green',
  INVITED: 'amber',
  DEACTIVATED: 'slate',
};

export default function PeoplePage() {
  const searchParams = useSearchParams();
  // Pre-fills from a global-search result deep link (?search=name), e.g. /people?search=Priya.
  const [search, setSearch] = useState(() => searchParams.get('search') ?? '');
  const [data, setData] = useState<ListResp | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async (q: string) => {
    setState('loading');
    try {
      const res = await apiFetch<ListResp>(`/employees?search=${encodeURIComponent(q)}&pageSize=50`);
      setData(res);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(search), 250);
    return () => clearTimeout(t);
  }, [search, load]);

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">People</h1>
          <p className="mt-1 text-sm text-slate-500">Employee directory</p>
        </div>
        <Link href="/people/new">
          <Button>Add employee</Button>
        </Link>
      </div>

      <div className="mt-4 max-w-sm">
        <Input
          placeholder="Search name, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="mt-4 overflow-hidden">
        {state === 'loading' ? (
          <LoadingState />
        ) : state === 'error' ? (
          <ErrorState description="Could not load the directory." onRetry={() => void load(search)} />
        ) : !data || data.items.length === 0 ? (
          <EmptyState
            title="No employees found"
            description={search ? 'Try a different search.' : 'Add your first employee to get started.'}
            action={
              <Link href="/people/new">
                <Button size="sm">Add employee</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Name</th>
                  <th className="px-4 py-2.5 font-medium">Role</th>
                  <th className="px-4 py-2.5 font-medium">Department</th>
                  <th className="px-4 py-2.5 font-medium">Team</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-slate-800">{e.name}</div>
                      <div className="text-xs text-slate-400">{e.email}</div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">
                      {e.role}
                      {e.resourceType === 'FREELANCE' ? (
                        <Badge tone="blue" className="ml-2">
                          Freelance
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{e.department?.name ?? '—'}</td>
                    <td className="px-4 py-2.5 text-slate-600">{e.team?.name ?? '—'}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={STATUS_TONE[e.status] ?? 'slate'}>{e.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
              {data.total} {data.total === 1 ? 'person' : 'people'}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
