'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, CardContent, Input, Label } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

export default function NewClientPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const org = await apiFetch<{ id: string }>('/client-orgs', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      router.push(`/clients/${org.id}/new-user`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the client organization');
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
        Creates the client organization. Next you&apos;ll add their first client-portal user.
      </p>

      <Card className="mt-4">
        <CardContent className="pt-6">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="name">Organization name</Label>
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

            {error ? <p className="text-sm text-slate-900">{error}</p> : null}

            <div className="flex gap-3">
              <Button type="submit" disabled={saving}>
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
