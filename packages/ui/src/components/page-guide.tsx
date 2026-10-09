'use client';

import * as React from 'react';
import { ChevronDown, HelpCircle } from 'lucide-react';
import { cn } from '../lib/cn';

/**
 * The short "how this screen works" panel that sits under a page title.
 *
 * Written for the person opening a screen for the first time, who has nobody to
 * ask. It answers the two questions a status chip cannot: what am I looking at,
 * and what am I expected to do about it.
 *
 * Collapsible, and it REMEMBERS being dismissed (per screen, in localStorage) —
 * guidance that cannot be put away stops being guidance and becomes clutter for
 * the person who reads it on day one and uses the screen daily thereafter.
 */
export function PageGuide({
  id,
  title = 'How this works',
  steps,
  notes,
  className,
}: {
  /** Stable key for remembering the collapsed state, e.g. 'leave'. */
  id: string;
  title?: string;
  /** The ordered path through the screen. Each is a short label + why it matters. */
  steps?: { label: string; detail: string }[];
  /** Anything that is not a step: rules, warnings, "who can do this". */
  notes?: React.ReactNode[];
  className?: string;
}) {
  const storageKey = `guide:${id}:collapsed`;
  // Start expanded, then correct after mount — reading localStorage during
  // render would disagree with the server-rendered markup.
  const [collapsed, setCollapsed] = React.useState(false);

  React.useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(storageKey) === '1');
    } catch {
      /* private mode / storage disabled — guidance simply stays open */
    }
  }, [storageKey]);

  function toggle() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, next ? '1' : '0');
      } catch {
        /* not being able to remember is not a reason to fail */
      }
      return next;
    });
  }

  return (
    <section
      className={cn(
        'ui-guide px-4 py-3',
        className,
      )}
    >
      <button
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <HelpCircle className="h-4 w-4 shrink-0 text-accent" />
        <span className="text-sm font-medium text-slate-800">{title}</span>
        <ChevronDown
          className={cn(
            'ml-auto h-4 w-4 shrink-0 text-slate-400 transition-transform',
            collapsed ? '-rotate-90' : '',
          )}
        />
      </button>

      {collapsed ? null : (
        <div className="mt-2.5 flex flex-col gap-2">
          {steps && steps.length > 0 ? (
            <ol className="flex flex-col gap-1.5">
              {steps.map((s, i) => (
                <li key={s.label} className="flex items-start gap-2.5 text-xs">
                  <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[10px] font-bold text-accent">
                    {i + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="font-semibold text-slate-700">{s.label}</span>
                    <span className="text-slate-500"> — {s.detail}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {notes?.map((n, i) => (
            <p key={i} className="text-xs leading-relaxed text-slate-500">
              {n}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
