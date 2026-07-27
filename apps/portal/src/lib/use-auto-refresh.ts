'use client';

import { useEffect, useRef } from 'react';

/**
 * Keep the portal current without the client pressing refresh.
 *
 * No socket here, unlike the staff app: a client's window sits open and idle
 * for long stretches, and the events they care about (a status moving, an
 * update posted, a file released) happen minutes or hours apart, not seconds.
 * Refetching when they come back to the tab, plus a slow interval, covers that
 * completely — and avoids holding a live connection open per client for
 * something that changes a handful of times a day.
 */
export function useAutoRefresh(
  refresh: () => void | Promise<void>,
  options: { intervalMs?: number; enabled?: boolean } = {},
): void {
  const { intervalMs = 30_000, enabled = true } = options;

  const latest = useRef(refresh);
  latest.current = refresh;

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

    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [enabled, intervalMs]);
}
