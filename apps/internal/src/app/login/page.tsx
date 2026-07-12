'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Input, Label } from '@rademics/ui';
import { apiFetch, type Me } from '@/lib/api';
import { setToken } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
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
      {/* ── Brand panel: light, with a soft bluish background design (Spec §9). ── */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-blue-50 via-white to-blue-100/70 p-12 lg:flex">
        {/* Ambient blue glow */}
        <div className="pointer-events-none absolute -left-16 -top-16 h-72 w-72 rounded-full bg-blue-200/50 blur-3xl" />
        <div className="pointer-events-none absolute right-8 top-1/3 h-64 w-64 rounded-full bg-brand-blue/10 blur-3xl" />

        {/* Layered waves along the bottom */}
        <svg
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 w-full"
          viewBox="0 0 800 600"
          fill="none"
          preserveAspectRatio="xMidYMax slice"
          aria-hidden="true"
        >
          <path d="M0,360 C180,300 320,440 520,370 C660,322 740,392 800,360 L800,600 L0,600 Z" fill="#DBEAFE" fillOpacity="0.7" />
          <path d="M0,440 C200,392 340,500 560,450 C700,418 760,470 800,450 L800,600 L0,600 Z" fill="#BFDBFE" fillOpacity="0.6" />
          <path d="M0,520 C220,480 380,560 600,520 C720,498 770,532 800,520 L800,600 L0,600 Z" fill="#93C5FD" fillOpacity="0.45" />
        </svg>

        {/* Wordmark */}
        <div className="relative z-10 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue to-brand-navy text-sm font-bold text-white shadow-lg shadow-brand-blue/30">
            R
          </span>
          <span className="text-xl font-bold tracking-tight text-brand-navy">Rademics</span>
          <span className="rounded border border-brand-navy/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-brand-navy/60">
            ERP
          </span>
        </div>

        {/* Headline */}
        <div className="relative z-10">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-brand-navy text-balance">
            Everything your studio<br />runs on, in{' '}
            <span className="text-brand-blue">one place.</span>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-slate-500">
            People, attendance, projects, files, finance &amp; reports — one calm,
            role-based system, with a client portal and an AI assistant.
          </p>
        </div>

        <p className="relative z-10 font-mono text-xs text-slate-400">
          © {new Date().getFullYear()} Rademics · Internal workspace
        </p>
      </div>

      {/* ── Sign-in form ── */}
      <div className="flex w-full items-center justify-center bg-white px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue to-brand-navy text-sm font-bold text-white">
              R
            </span>
            <span className="text-xl font-bold tracking-tight text-brand-navy">Rademics</span>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
          <p className="mt-1.5 text-sm text-slate-500">Sign in to your workspace to continue.</p>

          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Email address</Label>
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
              <div className="relative">
                <Input
                  id="password"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
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

            {error ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}

            {/* Login keeps its brand navy CTA (the interior's primary is now near-black). */}
            <Button type="submit" disabled={loading} className="mt-2 h-11 !bg-brand-navy hover:!bg-brand-navy/90">
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-8 text-center font-mono text-[11px] uppercase tracking-widest text-slate-400">
            Encrypted · Role-based access
          </p>
        </div>
      </div>
    </div>
  );
}
