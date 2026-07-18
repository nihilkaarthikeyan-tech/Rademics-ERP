'use client';

import { useEffect, useRef, useState } from 'react';
import Script from 'next/script';

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

/** True once a real site key is configured — pages use this to gate their submit button. */
export const TURNSTILE_ENABLED = Boolean(SITE_KEY);

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
    };
  }
}

/**
 * Cloudflare Turnstile CAPTCHA widget (Spec §10 bot protection). Renders nothing
 * if NEXT_PUBLIC_TURNSTILE_SITE_KEY isn't set — safe no-op until Turnstile is
 * actually configured, matching the backend's TurnstileService.
 */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  // Surfaced on failure so a blocked/broken widget doesn't just leave the submit
  // button silently disabled forever with no explanation (§10 must not become a
  // hard lockout when the third-party script is unreachable).
  const [errored, setErrored] = useState(false);

  // Cloudflare's api.js loads once and is reused across client-side (soft) navigations.
  // On a soft nav the <Script> below does NOT re-fire onLoad, so if the global is
  // already present we must flag it ourselves — otherwise the widget never renders and
  // the submit button stays disabled until a hard refresh.
  useEffect(() => {
    if (window.turnstile) setScriptLoaded(true);
  }, []);

  useEffect(() => {
    if (!scriptLoaded || !ref.current || !window.turnstile) return;
    window.turnstile.render(ref.current, {
      sitekey: SITE_KEY,
      callback: (token: string) => {
        setErrored(false);
        onToken(token);
      },
      'expired-callback': () => onToken(null),
      'error-callback': () => {
        setErrored(true);
        onToken(null);
      },
    });
  }, [scriptLoaded, onToken]);

  if (!SITE_KEY) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
        onError={() => setErrored(true)}
      />
      <div ref={ref} />
      {errored ? (
        <p className="text-xs text-slate-500">
          Verification didn't load.{' '}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="underline hover:text-slate-700"
          >
            Refresh the page
          </button>{' '}
          and try again. If this keeps happening, a browser extension or network filter may be blocking challenges.cloudflare.com.
        </p>
      ) : null}
    </>
  );
}
