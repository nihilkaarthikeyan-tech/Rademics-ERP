'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Label } from '@rademics/ui';
import { apiFetch, type Me } from '@/lib/api';
import { setToken } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ accessToken: string; user: Me }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (res.user.role !== 'CLIENT') {
        // Portal is for client users only (Spec §5.1 — no cross-app sessions).
        setError('This portal is for client accounts only.');
        return;
      }
      setToken(res.accessToken);
      router.push('/dashboard');
    } catch {
      setError('Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* ── Brand panel. Swap the logotype for <img src="/logo.svg" /> once a logo file
          is dropped into apps/portal/public/. ── */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand-navy via-brand-navy to-[#0d1526] p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold tracking-tight">Rademics</span>
          <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">Client Portal</span>
        </div>

        <div className="relative z-10">
          <h1 className="text-4xl font-semibold leading-tight">
            Your projects,<br />clear and up to date.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-white/70">
            Track progress, review and approve deliverables, download shared files, and
            view your invoices — all in one secure place.
          </p>
        </div>

        <p className="relative z-10 text-xs text-white/40">
          © {new Date().getFullYear()} Rademics. All rights reserved.
        </p>

        <div className="pointer-events-none absolute -right-24 top-1/4 h-80 w-80 rounded-full bg-accent/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 -left-10 h-72 w-72 rounded-full bg-brand-gold/10 blur-3xl" />
      </div>

      {/* ── Sign-in form ── */}
      <div className="flex w-full items-center justify-center bg-slate-50 px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <span className="text-2xl font-bold text-brand-navy">Rademics</span>
            <span className="ml-1 text-sm text-slate-500">Client Portal</span>
          </div>

          <h2 className="text-2xl font-semibold text-slate-900">Welcome back</h2>
          <p className="mt-1 text-sm text-slate-500">Sign in to view your projects.</p>

          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={loading} className="mt-2 h-11">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-8 text-center text-xs text-slate-400">
            Rademics · Client Portal
          </p>
        </div>
      </div>
    </div>
  );
}
