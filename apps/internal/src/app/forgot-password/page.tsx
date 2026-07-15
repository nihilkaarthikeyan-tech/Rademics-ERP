'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button, Input, Label } from '@rademics/ui';
import { apiFetch } from '@/lib/api';
import { AuthCard } from '@/components/auth/password-token-form';
import { Turnstile, TURNSTILE_ENABLED } from '@/components/turnstile';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch<{ ok: true }>('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email, captchaToken }),
      });
      setSent(true);
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <AuthCard title="Check your email">
        <p className="text-sm leading-relaxed text-slate-500">
          If an account exists for <span className="font-medium text-slate-700">{email}</span>,
          we&apos;ve sent a password reset link. It expires in 30 minutes.
        </p>
        <Link href="/login" className="mt-6 block text-center text-sm font-medium text-brand-blue hover:underline">
          Back to sign in
        </Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title="Forgot your password?"
      subtitle="Enter your email and we'll send you a reset link."
    >
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

        <Turnstile onToken={setCaptchaToken} />

        {error ? (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          disabled={loading || (TURNSTILE_ENABLED && !captchaToken)}
          className="mt-2 h-11 !bg-brand-navy hover:!bg-brand-navy/90"
        >
          {loading ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>

      <Link href="/login" className="mt-6 block text-center text-sm font-medium text-brand-blue hover:underline">
        Back to sign in
      </Link>
    </AuthCard>
  );
}
