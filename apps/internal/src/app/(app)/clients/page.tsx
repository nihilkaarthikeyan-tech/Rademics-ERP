'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

interface ClientOrgRow {
  id: string;
  name: string;
  status: 'ACTIVE' | 'DEACTIVATED';
  _count: { users: number; projects: number };
}

/**
 * Client organization admin (Spec §2, §5.5) — SUPER_ADMIN only (portal.users.manage).
 * Creates/lists the ClientOrg records that the client portal's login and per-project
 * access grants are scoped to. See apps/api/src/portal/client-admin.controller.ts.
 */
export default function ClientsPage() {
  const [data, setData] = useState<ClientOrgRow[] | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await apiFetch<ClientOrgRow[]>('/client-orgs');
      setData(res);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function deactivate(org: ClientOrgRow) {
    if (!confirm(`Deactivate "${org.name}"? All ${org._count.users} client user(s) will be signed out and lose access.`)) {
      return;
    }
    setBusyId(org.id);
    try {
      await apiFetch(`/client-orgs/${org.id}/deactivate`, { method: 'POST', body: '{}' });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not deactivate the organization');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">Clients</h1>
          <p className="mt-1 text-sm text-slate-500">
            Client organizations — each has its own login and project scope in the client portal.
          </p>
        </div>
        <Link href="/clients/new">
          <Button>New client</Button>
        </Link>
      </div>

      <Card className="mt-4 overflow-hidden">
        {state === 'loading' ? (
          <LoadingState />
        ) : state === 'error' ? (
          <ErrorState description="Could not load clients." onRetry={() => void load()} />
        ) : !data || data.length === 0 ? (
          <EmptyState
            title="No clients yet"
            description="Create your first client organization to get started."
            action={
              <Link href="/clients/new">
                <Button size="sm">New client</Button>
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Organization</th>
                  <th className="px-4 py-2.5 font-medium">Client users</th>
                  <th className="px-4 py-2.5 font-medium">Projects</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((org) => (
                  <tr key={org.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-medium text-slate-800">{org.name}</td>
                    <td className="px-4 py-2.5 text-slate-600">{org._count.users}</td>
                    <td className="px-4 py-2.5 text-slate-600">{org._count.projects}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={org.status === 'ACTIVE' ? 'green' : 'slate'}>{org.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-2">
                        <Link href={`/clients/${org.id}/new-user`}>
                          <Button size="sm" variant="outline" disabled={org.status !== 'ACTIVE'}>
                            Add user
                          </Button>
                        </Link>
                        {org.status === 'ACTIVE' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === org.id}
                            onClick={() => void deactivate(org)}
                          >
                            Deactivate
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
              {data.length} {data.length === 1 ? 'client' : 'clients'}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
