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

  useEffect(() => {
    if (!scriptLoaded || !ref.current || !window.turnstile) return;
    window.turnstile.render(ref.current, {
      sitekey: SITE_KEY,
      callback: (token: string) => onToken(token),
      'expired-callback': () => onToken(null),
      'error-callback': () => onToken(null),
    });
  }, [scriptLoaded, onToken]);

  if (!SITE_KEY) return null;

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={() => setScriptLoaded(true)}
      />
      <div ref={ref} />
    </>
  );
}
