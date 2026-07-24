import { useEffect, useState } from 'react';
import { Button, Card, Input, Label } from '@rademics/ui';

export function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill the last successful sign-in (password comes back decrypted from the
  // OS-encrypted store only on this user's own Windows account).
  useEffect(() => {
    void window.rademicsDesktop.getSavedLogin().then((saved) => {
      if (saved.email) setEmail(saved.email);
      if (saved.password) setPassword(saved.password);
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // No CAPTCHA in the native app — the server trusts the desktop key instead.
      const res = await window.rademicsDesktop.login({ email, password, captchaToken: null, remember });
      if (!res.ok) setError(res.error ?? 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  }

  return (
    // Aurora ground from the body shows around a frosted card — same visual
    // language as the staff portal; login keeps its brand navy CTA (Spec §9).
    <div className="flex h-full flex-col justify-center gap-4 px-5 py-8">
      <Card className="animate-rise flex flex-col gap-6 p-6">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-blue to-brand-navy text-sm font-bold text-white shadow-lg shadow-brand-blue/30">
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

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-brand-navy"
          />
          Remember me on this computer
        </label>

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        {/* Login keeps its brand navy CTA, matching the website's sign-in. */}
        <Button type="submit" disabled={loading} className="mt-2 h-11 !bg-brand-navy hover:!bg-brand-navy/90">
          {loading ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
      </Card>

      <p className="text-center font-mono text-[10px] uppercase tracking-widest text-slate-500">
        Check-in starts only after you sign in and click Check In.
      </p>
    </div>
  );
}
