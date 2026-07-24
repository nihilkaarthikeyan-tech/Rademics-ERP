'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, Card, CardContent, Input, Label } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

export default function NewClientUserPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [form, setForm] = useState({ name: '', email: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function set<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await apiFetch(`/client-orgs/${id}/users`, {
        method: 'POST',
        body: JSON.stringify(form),
      });
      router.push('/clients');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the client user');
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
      <h1 className="text-xl font-semibold text-slate-800">Add client user</h1>
      <p className="mt-1 text-sm text-slate-500">
        They receive an email invite to set their password and sign in at the client portal.
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
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                required
              />
            </div>

            {error ? <p className="text-sm text-slate-900">{error}</p> : null}

            <div className="flex gap-3">
              <Button type="submit" disabled={saving}>
                {saving ? 'Creating…' : 'Create & send invite'}
              </Button>
              <Link href="/clients">
                <Button type="button" variant="outline">
                  Skip for now
                </Button>
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
