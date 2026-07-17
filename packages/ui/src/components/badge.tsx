import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Small status chip. Aurora Glass direction (2026-07-18): severity reads by soft
 * colour + label — pale green (positive) → sky (info) → amber (warning) → rose
 * (critical). Callers keep the same `tone` API.
 */
export function Badge({
  className,
  tone = 'slate',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & {
  tone?: 'slate' | 'blue' | 'green' | 'amber' | 'red';
}) {
  const tones: Record<string, string> = {
    slate: 'bg-slate-100 text-slate-600',
    blue: 'bg-info-soft text-info',
    green: 'bg-success-soft text-success',
    amber: 'bg-warning-soft text-warning',
    red: 'bg-danger-soft text-danger',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
