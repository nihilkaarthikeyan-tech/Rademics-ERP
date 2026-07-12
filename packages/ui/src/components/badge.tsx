import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Small status chip. Interior is monochrome (user direction): severity is encoded by
 * FILL WEIGHT, not hue — neutral → outlined (positive) → mid-grey (warning) → solid
 * black (critical). Callers keep the same `tone` API; only the rendering is B&W.
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
    blue: 'bg-slate-100 text-slate-700',
    green: 'border border-slate-300 bg-white text-slate-700',
    amber: 'bg-slate-200 text-slate-800',
    red: 'bg-slate-900 text-white',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
