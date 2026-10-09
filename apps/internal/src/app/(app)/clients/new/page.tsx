'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, CardContent, Input, Label } from '@rademics/ui';
import { parseProjectCode } from '@rademics/types';
import { apiFetch, ApiError } from '@/lib/api';

interface Pairing {
  client:
    | { code: string; found: true; available: boolean; takenBy: string | null }
    | { code: string | null; found: false };
  projects: (
    | { number: number; code: string; found: true; name: string; matchesClient: boolean }
    | { number: number; code: string; found: false }
  )[];
}

/** "CL-008", "cl 8", "8" → 8. Same leniency as project codes. */
function parseClientCode(input: string): number | null {
  const m = /^(?:CL[\s-]*)?(\d{1,9})$/i.exec(input.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Create a client's account against the client ID reserved when their project
 * was created.
 *
 * Both codes are typed deliberately. Either one alone can be mistyped into
 * somebody else's; requiring the pair means a single wrong character produces a
 * mismatch and a refusal, rather than an account quietly attached to another
 * client's work. Both resolve to names on screen before anything is saved, so
 * the check a person actually performs is "is that the right project?", not
 * "did I copy the digits correctly?".
 */
export default function NewClientPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [clientInput, setClientInput] = useState('');
  const [projectsInput, setProjectsInput] = useState('');
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const clientNumber = parseClientCode(clientInput);
  const projectFragments = projectsInput.split(/[\s,]+/).filter(Boolean);
  const projectNumbers = [
    ...new Set(projectFragments.map(parseProjectCode).filter((n): n is number => n !== null)),
  ];
  const unparseable = projectFragments.filter((f) => parseProjectCode(f) === null);

  const key = `${clientNumber ?? ''}|${projectNumbers.join(',')}`;
  const latest = useRef(0);

  const verify = useCallback(async (clientN: number | null, projectNs: number[]) => {
    if (!clientN && projectNs.length === 0) {
      setPairing(null);
      return;
    }
    const id = ++latest.current;
    setChecking(true);
    try {
      const res = await apiFetch<Pairing>(
        `/client-orgs/verify-pairing?client=${clientN ?? ''}&projects=${projectNs.join(',')}`,
      );
      if (id === latest.current) setPairing(res);
    } catch {
      if (id === latest.current) setPairing(null);
    } finally {
      if (id === latest.current) setChecking(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void verify(clientNumber, projectNumbers), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, verify]);

  const clientOk = pairing?.client.found === true && pairing.client.available;
  const projectsOk =
    (pairing?.projects.length ?? 0) > 0 &&
    pairing!.projects.every((p) => p.found && p.matchesClient);
  const canSubmit =
    Boolean(name.trim() && email.trim()) &&
    clientOk &&
    projectsOk &&
    unparseable.length === 0 &&
    !checking &&
    !saving;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch('/client-orgs/onboard', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          clientNumber,
          projectNumbers,
        }),
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
        Use the client ID and project number shown when you created the project.
      </p>

      <Card className="mt-4">
        <CardContent className="pt-6">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Client name</Label>
              <Input
                id="name"
                placeholder="Enter the client's name"
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
                placeholder="Enter their email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <p className="text-xs text-slate-500">Their portal login. They&apos;ll be emailed an invite.</p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="client-id">Client ID</Label>
                <Input
                  id="client-id"
                  placeholder="Enter the client ID, e.g. CL-008"
                  value={clientInput}
                  onChange={(e) => setClientInput(e.target.value)}
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="project-no">Project number</Label>
                <Input
                  id="project-no"
                  placeholder="e.g. RAD-013"
                  value={projectsInput}
                  onChange={(e) => setProjectsInput(e.target.value)}
                  required
                />
              </div>
            </div>

            {clientInput.trim() || projectsInput.trim() ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
                {checking ? (
                  <p className="text-slate-500">Checking…</p>
                ) : !pairing ? (
                  <p className="text-slate-500">Enter a client ID and project number.</p>
                ) : (
                  <div className="flex flex-col gap-1.5">
                    {pairing.client.found ? (
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-slate-500">{pairing.client.code}</span>
                        <span className={pairing.client.available ? 'text-slate-800' : 'text-slate-800'}>
                          {pairing.client.available
                            ? 'reserved — ready for an account'
                            : `already used by ${pairing.client.takenBy}`}
                        </span>
                      </div>
                    ) : clientInput.trim() ? (
                      <div className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-slate-500">
                          {pairing.client.code ?? clientInput.trim()}
                        </span>
                        <span className="text-slate-800">no client with this ID</span>
                      </div>
                    ) : null}

                    {pairing.projects.map((p) => (
                      <div key={p.number} className="flex items-baseline gap-2">
                        <span className="font-mono text-xs text-slate-500">{p.code}</span>
                        <span className="text-slate-800">
                          {!p.found
                            ? 'no project with this number'
                            : p.matchesClient
                              ? p.name
                              : `${p.name} — does not belong to this client ID`}
                        </span>
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
              <Button type="submit" disabled={!canSubmit}>
                {saving ? 'Creating…' : 'Create client'}
              </Button>
              <Link href="/clients">
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
