'use client';

import { useEffect, useRef } from 'react';
import { connectPresence } from './socket';

/**
 * Keep a page's data current without the user pressing refresh.
 *
 * Three triggers, deliberately layered — each covers what the others miss:
 *
 *  - socket events: instant, but only for mutations the server announces, and
 *    silently useless if the connection dropped while the laptop slept
 *  - window focus / tab visible: catches everything missed while away, which is
 *    the case that actually bites (come back to a screen, act on stale data)
 *  - a slow interval: the floor for a screen left open and watched, e.g. on a
 *    wall display, where neither of the above ever fires
 *
 * The interval is slow on purpose. It is a safety net, not the mechanism —
 * polling fast enough to feel live would put every open tab on the API for no
 * benefit the socket doesn't already provide.
 */
export function useAutoRefresh(
  refresh: () => void | Promise<void>,
  options: { events?: string[]; intervalMs?: number; enabled?: boolean } = {},
): void {
  const { events = [], intervalMs = 30_000, enabled = true } = options;

  // Held in a ref so a caller passing an inline arrow doesn't tear down and
  // rebuild the socket on every render.
  const latest = useRef(refresh);
  latest.current = refresh;

  const eventKey = events.join(',');

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const run = () => {
      if (!cancelled && document.visibilityState === 'visible') void latest.current();
    };

    const onFocus = () => run();
    const onVisible = () => {
      if (document.visibilityState === 'visible') run();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(run, intervalMs);

    // Only open a socket if this page actually cares about pushed events.
    const names = eventKey ? eventKey.split(',') : [];
    const socket = names.length > 0 ? connectPresence() : null;
    names.forEach((name) => socket?.on(name, run));

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
      names.forEach((name) => socket?.off(name, run));
      socket?.disconnect();
    };
  }, [enabled, eventKey, intervalMs]);
}
