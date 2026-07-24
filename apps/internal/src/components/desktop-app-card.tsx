'use client';

import { useEffect, useState } from 'react';
import { Download, Monitor } from 'lucide-react';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@rademics/ui';
import { apiFetch } from '@/lib/api';

interface DesktopVersionInfo {
  version: string | null;
  downloadUrl: string | null;
}

/**
 * Dashboard card for getting/updating the Rademics Desktop Agent (2026-07-24) —
 * always shows the CURRENT published build, so it doubles as both a first-time
 * download and a way to notice a newer version exists. The website has no way
 * to know what's installed locally, so this is deliberately a standing,
 * always-correct prompt rather than a per-user "you're outdated" alert.
 * Renders nothing until a version has actually been published (GET /desktop/version
 * returns nulls) — see .github/workflows/desktop-installer.yml (publish=true).
 */
export function DesktopAppCard() {
  const [info, setInfo] = useState<DesktopVersionInfo | null>(null);

  useEffect(() => {
    apiFetch<DesktopVersionInfo>('/desktop/version')
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  if (!info?.downloadUrl) return null;

  return (
    <Card className="animate-rise">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-slate-400" />
          Desktop Agent
        </CardTitle>
        {info.version ? <Badge tone="blue">v{info.version} available</Badge> : null}
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-500">
            The Windows app for check-in/check-out and activity tracking. Already installed? This
            is also always the current version — grab it again anytime to update manually.
          </p>
          <a href={info.downloadUrl} className="shrink-0">
            <Button className="whitespace-nowrap">
              <Download className="mr-2 h-4 w-4" />
              Download for Windows
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
