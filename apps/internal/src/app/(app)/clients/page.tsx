'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, EmptyState, ErrorState, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

interface ClientOrgRow {
  id: string;
  code: string;
  /** Null while the client ID is only reserved — no account created yet. */
  name: string | null;
  awaitingAccount: boolean;
  status: 'ACTIVE' | 'DEACTIVATED';
  _count: { users: number; projects: number };
}

/**
 * Client admin (Spec §2, §5.5) — SUPER_ADMIN only (portal.users.manage).
 *
 * "Organization" is gone from the wording: it is a real record underneath (the
 * portal, invoices and the deactivate kill switch all hang off it) but it was
 * never a thing a Super Admin should have to think about. A client is a client.
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
    if (!confirm(`Deactivate "${org.name ?? org.code}"? All ${org._count.users} client login(s) will be signed out and lose access.`)) {
      return;
    }
    setBusyId(org.id);
    try {
      await apiFetch(`/client-orgs/${org.id}/deactivate`, { method: 'POST', body: '{}' });
      await load();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not deactivate the client');
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
            Each client has their own portal login and sees only the projects you give them.
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
            description="Create your first client to get started."
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
                  <th className="px-4 py-2.5 font-medium">Client ID</th>
                  <th className="px-4 py-2.5 font-medium">Client</th>
                  <th className="px-4 py-2.5 font-medium">Logins</th>
                  <th className="px-4 py-2.5 font-medium">Projects</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.map((org) => (
                  <tr key={org.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-slate-500">{org.code}</td>
                    <td className="px-4 py-2.5 font-medium text-slate-800">
                      {org.name ?? (
                        <span className="font-normal text-amber-700">Reserved — no account yet</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{org._count.users}</td>
                    <td className="px-4 py-2.5 text-slate-600">{org._count.projects}</td>
                    <td className="px-4 py-2.5">
                      <Badge tone={org.status === 'ACTIVE' ? 'green' : 'slate'}>{org.status}</Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex justify-end gap-2">
                        {/* A reservation has no account to add a second person to —
                            the first one is created on the New client form, which is
                            where its code has to be typed. */}
                        {org.awaitingAccount ? (
                          <Link href="/clients/new">
                            <Button size="sm" variant="outline" disabled={org.status !== 'ACTIVE'}>
                              Create account
                            </Button>
                          </Link>
                        ) : (
                          <Link href={`/clients/${org.id}/new-user`}>
                            <Button size="sm" variant="outline" disabled={org.status !== 'ACTIVE'}>
                              Add person
                            </Button>
                          </Link>
                        )}
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
