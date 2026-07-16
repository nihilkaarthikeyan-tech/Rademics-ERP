'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import { Button, Input, Label } from '@rademics/ui';
import { apiFetch, type Me } from '@/lib/api';
import { setToken } from '@/lib/session';
import { Turnstile, TURNSTILE_ENABLED } from '@/components/turnstile';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch<{ accessToken: string; user: Me }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier: email, password, captchaToken }),
      });
      if (res.user.role !== 'CLIENT') {
        // Portal is for client users only (Spec §5.1 — no cross-app sessions).
        setError('This portal is for client accounts only.');
        return;
      }
      setToken(res.accessToken);
      router.push('/dashboard');
    } catch {
      setError('Invalid login ID or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen">
      {/* ── Brand panel: light, soft teal background — deliberately distinct from
          the internal app's blue, so the two logins don't read as the same product. ── */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-teal-50 via-white to-teal-100/70 p-12 lg:flex">
        {/* Ambient teal glow */}
        <div className="pointer-events-none absolute -left-16 -top-16 h-72 w-72 rounded-full bg-teal-200/50 blur-3xl" />
        <div className="pointer-events-none absolute right-8 top-1/3 h-64 w-64 rounded-full bg-client-teal/10 blur-3xl" />

        {/* Layered waves along the bottom */}
        <svg
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 w-full"
          viewBox="0 0 800 600"
          fill="none"
          preserveAspectRatio="xMidYMax slice"
          aria-hidden="true"
        >
          <path d="M0,360 C180,300 320,440 520,370 C660,322 740,392 800,360 L800,600 L0,600 Z" fill="#CCFBF1" fillOpacity="0.7" />
          <path d="M0,440 C200,392 340,500 560,450 C700,418 760,470 800,450 L800,600 L0,600 Z" fill="#99F6E4" fillOpacity="0.6" />
          <path d="M0,520 C220,480 380,560 600,520 C720,498 770,532 800,520 L800,600 L0,600 Z" fill="#5EEAD4" fillOpacity="0.45" />
        </svg>

        {/* Wordmark */}
        <div className="relative z-10 flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-client-teal to-client-deep text-sm font-bold text-white shadow-lg shadow-client-teal/30">
            R
          </span>
          <span className="text-xl font-bold tracking-tight text-client-deep">Rademics</span>
          <span className="rounded border border-client-deep/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-client-deep/60">
            Client Portal
          </span>
        </div>

        {/* Headline */}
        <div className="relative z-10">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-client-deep text-balance">
            Your projects,<br />
            clear and{' '}
            <span className="text-client-teal">up to date.</span>
          </h1>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-slate-500">
            Track progress, review and approve deliverables, download shared files, and
            view your invoices — all in one secure place.
          </p>
        </div>

        <p className="relative z-10 font-mono text-xs text-slate-400">
          © {new Date().getFullYear()} Rademics · Client Portal
        </p>
      </div>

      {/* ── Sign-in form ── */}
      <div className="flex w-full items-center justify-center bg-white px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-client-teal to-client-deep text-sm font-bold text-white">
              R
            </span>
            <span className="text-xl font-bold tracking-tight text-client-deep">Rademics</span>
            <span className="ml-1 text-sm text-slate-500">Client Portal</span>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
          <p className="mt-1.5 text-sm text-slate-500">Sign in to view your projects.</p>

          <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">Login ID</Label>
              <Input
                id="email"
                type="text"
                autoComplete="username"
                placeholder="RDM-XXXXXX"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link
                  href="/forgot-password"
                  className="text-xs font-medium text-client-teal hover:underline"
                >
                  Forgot password?
                </Link>
              </div>
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
            <Turnstile onToken={setCaptchaToken} />
            {error ? (
              <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}
            {/* Login keeps its client-teal CTA (the interior's primary is near-black). */}
            <Button
              type="submit"
              disabled={loading || (TURNSTILE_ENABLED && !captchaToken)}
              className="mt-2 h-11 !bg-client-deep hover:!bg-client-deep/90"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <p className="mt-8 text-center font-mono text-[11px] uppercase tracking-widest text-slate-400">
            Encrypted · Client Portal
          </p>
        </div>
      </div>
    </div>
  );
}
