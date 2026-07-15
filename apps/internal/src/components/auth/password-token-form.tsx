'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Input, Label } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

/**
 * Shared form for /set-password (invite) and /reset-password (forgot password).
 * Consumes the emailed token via POST /auth/set-password or /auth/reset-password (Spec §5.1).
 */
export function PasswordTokenForm({ mode }: { mode: 'set' | 'reset' }) {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const title = mode === 'set' ? 'Set your password' : 'Reset your password';

  if (!token) {
    return (
      <AuthCard title={title}>
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
          This link is missing its token. Please use the link from your email, or request a new
          one.
        </p>
        <Link href="/forgot-password" className="mt-4 block text-center text-sm font-medium text-brand-blue hover:underline">
          Request a new link
        </Link>
      </AuthCard>
    );
  }

  if (done) {
    return (
      <AuthCard title="Password saved">
        <p className="text-sm text-slate-500">
          Your password has been {mode === 'set' ? 'set' : 'reset'}. You can now sign in with it.
        </p>
        <Link href="/login" className="mt-6 block">
          <Button className="h-11 w-full !bg-brand-navy hover:!bg-brand-navy/90">Go to sign in</Button>
        </Link>
      </AuthCard>
    );
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 10 || !/\d/.test(password)) {
      setError('Password must be at least 10 characters and include a number.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setLoading(true);
    try {
      await apiFetch<void>(`/auth/${mode === 'set' ? 'set-password' : 'reset-password'}`, {
        method: 'POST',
        body: JSON.stringify({ token, password }),
      });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? 'This link is invalid or has expired. Please request a new one.'
          : 'Something went wrong. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthCard
      title={title}
      subtitle="At least 10 characters, including a number."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">New password</Label>
          <div className="relative">
            <Input
              id="password"
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="pr-10"
              required
            />
            <button
              type="button"
              onClick={() => setShowPw((v) => !v)}
              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-400 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={showPw ? 'Hide password' : 'Show password'}
            >
              {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            placeholder="••••••••"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={loading} className="mt-2 h-11 !bg-brand-navy hover:!bg-brand-navy/90">
          {loading ? 'Saving…' : 'Save password'}
        </Button>
      </form>
    </AuthCard>
  );
}

export function AuthCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue to-brand-navy text-sm font-bold text-white">
            R
          </span>
          <span className="text-xl font-bold tracking-tight text-brand-navy">Rademics</span>
          <span className="rounded border border-brand-navy/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-brand-navy/60">
            ERP
          </span>
        </div>

        <h2 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h2>
        {subtitle ? <p className="mt-1.5 text-sm text-slate-500">{subtitle}</p> : null}

        <div className="mt-8">{children}</div>
      </div>
    </div>
  );
}
