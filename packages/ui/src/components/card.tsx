import * as React from 'react';
import { cn } from '../lib/cn';

/**
 * Aurora Glass surface (2026-07-18 direction, user-approved). Frosted and
 * translucent with a colour-tinted elevation shadow — it sits on the aurora ground
 * and blurs it through. Shared by both apps; kept a touch more opaque (65%) than the
 * dashboard's showcase panels so it stays readable in dense and nested contexts.
 */
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-white/70 bg-white/65 shadow-glass backdrop-blur-xl',
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-2', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-sm font-semibold text-slate-800', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-2', className)} {...props} />;
}
