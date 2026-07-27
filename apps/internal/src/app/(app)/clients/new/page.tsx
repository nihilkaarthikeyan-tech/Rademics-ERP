'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, CardContent, Input, Label } from '@rademics/ui';
import { formatProjectCode, parseProjectCode } from '@rademics/types';
import { apiFetch, ApiError } from '@/lib/api';

interface LookupRow {
  number: number;
  code: string;
  found: boolean;
  id?: string;
  name?: string;
  status?: string;
  takenBy?: { id: string; name: string } | null;
}

/**
 * One-step client onboarding: name, email, project codes.
 *
 * The client organization is created server-side from the client's own name —
 * it is real (the portal, invoices and the deactivate kill switch all hang off
 * it) but it is not a decision a Super Admin should have to make, so it is not
 * asked for.
 *
 * The codes resolve to project NAMES on screen before anything is saved. That
 * confirmation is the whole safety story of typing a number: RAD-012 and
 * RAD-013 look alike and a wrong one shows a client another client's work,
 * which is the single most expensive mistake this form can make. The server
 * re-checks independently (see onboardClient) — this is the readable half.
 */
export default function NewClientPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [codesInput, setCodesInput] = useState('');
  const [lookup, setLookup] = useState<LookupRow[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Split on commas/spaces so "RAD-1, 2 rad-3" all work; unparseable fragments
  // are surfaced rather than silently dropped.
  const fragments = codesInput.split(/[\s,]+/).filter(Boolean);
  const parsed = fragments.map((f) => ({ raw: f, number: parseProjectCode(f) }));
  const validNumbers = [...new Set(parsed.filter((p) => p.number !== null).map((p) => p.number as number))];
  const unparseable = parsed.filter((p) => p.number === null).map((p) => p.raw);

  // Keyed on the resolved numbers, so reformatting ("7" → "RAD-007") doesn't refetch.
  const lookupKey = validNumbers.join(',');
  const latestRequest = useRef(0);

  const runLookup = useCallback(async (key: string) => {
    if (!key) {
      setLookup(null);
      return;
    }
    const requestId = ++latestRequest.current;
    setChecking(true);
    try {
      const rows = await apiFetch<LookupRow[]>(`/client-orgs/lookup-projects?numbers=${key}`);
      // Ignore a slow response that lost the race to a newer one.
      if (requestId === latestRequest.current) setLookup(rows);
    } catch {
      if (requestId === latestRequest.current) setLookup(null);
    } finally {
      if (requestId === latestRequest.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void runLookup(lookupKey), 300);
    return () => clearTimeout(t);
  }, [lookupKey, runLookup]);

  const missing = lookup?.filter((r) => !r.found) ?? [];
  const taken = lookup?.filter((r) => r.found && r.takenBy) ?? [];
  const usable = lookup?.filter((r) => r.found && !r.takenBy) ?? [];
  const blocked = unparseable.length > 0 || missing.length > 0 || taken.length > 0;
  const canSubmit = Boolean(name.trim() && email.trim()) && usable.length > 0 && !blocked && !checking;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch('/client-orgs/onboard', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), email: email.trim(), projectNumbers: validNumbers }),
      });
      router.push('/clients');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the client');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4">
        <Link href="/clients" className="text-sm text-slate-500 hover:text-slate-800">
          ← Back to Clients
        </Link>
      </div>
      <h1 className="text-xl font-semibold text-slate-800">New client</h1>
      <p className="mt-1 text-sm text-slate-500">
        They get a portal login and see only the projects you list here.
      </p>

      <Card className="mt-4">
        <CardContent className="pt-6">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Client name</Label>
              <Input
                id="name"
                placeholder="Northwind Publishing"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                minLength={2}
                maxLength={150}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="contact@northwind.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <p className="text-xs text-slate-400">Their portal login. They&apos;ll be emailed an invite.</p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="codes">Project number</Label>
              <Input
                id="codes"
                placeholder="RAD-001, RAD-004"
                value={codesInput}
                onChange={(e) => setCodesInput(e.target.value)}
                required
              />
              <p className="text-xs text-slate-400">
                Find the number on the project page. Separate several with commas.
              </p>
            </div>

            {/* Confirmation panel — never save on a number alone. */}
            {codesInput.trim() ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                {checking ? (
                  <p className="text-slate-500">Checking…</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {usable.map((r) => (
                      <div key={r.number} className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-slate-500">{r.code}</span>
                        <span className="font-medium text-slate-800">{r.name}</span>
                        {r.status && r.status !== 'ACTIVE' ? (
                          <span className="text-xs text-slate-400">({r.status.toLowerCase()})</span>
                        ) : null}
                      </div>
                    ))}
                    {taken.map((r) => (
                      <div key={r.number} className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-slate-500">{r.code}</span>
                        <span className="text-slate-800">
                          {r.name} — already belongs to {r.takenBy?.name}
                        </span>
                      </div>
                    ))}
                    {missing.map((r) => (
                      <div key={r.number} className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-slate-500">{r.code}</span>
                        <span className="text-slate-800">no project with this number</span>
                      </div>
                    ))}
                    {unparseable.map((raw) => (
                      <div key={raw} className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-slate-500">{raw}</span>
                        <span className="text-slate-800">not a project number</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            {error ? <p className="text-sm text-slate-900">{error}</p> : null}

            <div className="flex gap-3">
              <Button type="submit" disabled={!canSubmit || saving}>
                {saving ? 'Creating…' : 'Create client'}
              </Button>
              <Link href="/clients">
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Link>
            </div>
            {usable.length > 0 && !blocked ? (
              <p className="text-xs text-slate-400">
                {name.trim() || 'This client'} will see{' '}
                {usable.length === 1 ? '1 project' : `${usable.length} projects`}:{' '}
                {usable.map((r) => formatProjectCode(r.number)).join(', ')}.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
