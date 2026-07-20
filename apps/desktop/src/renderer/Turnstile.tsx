import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
    };
  }
}

/**
 * Same render pattern as apps/internal/src/components/turnstile.tsx, except the
 * site key arrives via IPC (window.rademicsDesktop) instead of a NEXT_PUBLIC_*
 * build-time env var, since this isn't a Next.js app.
 */
export function Turnstile({ onToken }: { onToken: (token: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [siteKey, setSiteKey] = useState<string | null | undefined>(undefined);
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    window.rademicsDesktop.getTurnstileSiteKey().then(setSiteKey);
  }, []);

  useEffect(() => {
    if (!siteKey) return;
    if (window.turnstile) {
      setScriptLoaded(true);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.onload = () => setScriptLoaded(true);
    script.onerror = () => setErrored(true);
    document.head.appendChild(script);
  }, [siteKey]);

  useEffect(() => {
    if (!scriptLoaded || !ref.current || !window.turnstile || !siteKey) return;
    window.turnstile.render(ref.current, {
      sitekey: siteKey,
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
  }, [scriptLoaded, siteKey, onToken]);

  if (siteKey === undefined) return null; // still loading the config from main
  if (!siteKey) return null; // not configured — login proceeds without a captcha token

  return (
    <>
      <div ref={ref} />
      {errored ? (
        <p className="text-xs text-slate-500">
          Verification didn&apos;t load. Check your connection and reopen the app.
        </p>
      ) : null}
    </>
  );
}
