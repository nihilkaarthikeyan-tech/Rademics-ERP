import { useState } from 'react';
import { Button, Input, Label } from '@rademics/ui';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // No CAPTCHA in the native app — the server trusts the desktop key instead.
      const res = await window.rademicsDesktop.login({ email, password, captchaToken: null });
      if (!res.ok) setError(res.error ?? 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col justify-center gap-6 px-6 py-8">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue to-brand-navy text-sm font-bold text-white">
          R
        </span>
        <span className="text-lg font-bold tracking-tight text-brand-navy">Rademics</span>
        <span className="rounded border border-brand-navy/15 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-brand-navy/60">
          Desktop
        </span>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4">
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

      <p className="text-center font-mono text-[11px] uppercase tracking-widest text-slate-400">
        Check-in starts only after you sign in and click Check In.
      </p>
    </div>
  );
}
