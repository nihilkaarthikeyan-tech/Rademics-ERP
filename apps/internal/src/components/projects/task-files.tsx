'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileUp, ShieldAlert, ShieldCheck, Loader2 } from 'lucide-react';
import { Badge, Button } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';

interface Version {
  id: string;
  versionNumber: number;
  originalName: string;
  sizeBytes: number | null;
  scanStatus: 'PENDING' | 'SCANNING' | 'AVAILABLE' | 'INFECTED' | 'ERROR';
  visibility: 'INTERNAL' | 'CLIENT_VISIBLE';
  uploadedAt: string;
  uploadedBy: { id: string; name: string } | null;
}
interface FileAsset {
  id: string;
  displayName: string;
  versions: Version[];
}

const CAN_UPLOAD = ['SUPER_ADMIN', 'PM', 'TEAM_LEAD', 'EMPLOYEE'];
const CAN_FLIP = ['SUPER_ADMIN', 'PM'];

function fmtSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ScanBadge({ status }: { status: Version['scanStatus'] }) {
  if (status === 'AVAILABLE') return <Badge tone="green"><ShieldCheck className="mr-1 h-3 w-3" />Clean</Badge>;
  if (status === 'INFECTED') return <Badge tone="red"><ShieldAlert className="mr-1 h-3 w-3" />Quarantined</Badge>;
  if (status === 'ERROR') return <Badge tone="amber">Scan error</Badge>;
  return <Badge tone="slate"><Loader2 className="mr-1 h-3 w-3 animate-spin" />Scanning</Badge>;
}

/** Task files (Spec §5.6): presigned upload, version history, scan status, download. */
export function TaskFiles({ taskId }: { taskId: string }) {
  const me = useMe();
  const [assets, setAssets] = useState<FileAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setAssets(await apiFetch<FileAsset[]>(`/files?taskId=${taskId}`));
    } catch {
      /* silent */
    }
  }, [taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while any version is still scanning.
  useEffect(() => {
    const scanning = assets.some((a) => a.versions.some((v) => v.scanStatus === 'PENDING' || v.scanStatus === 'SCANNING'));
    if (!scanning) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [assets, load]);

  async function upload(file: File, fileAssetId?: string) {
    setBusy(true);
    setError(null);
    try {
      // 1) init → presigned PUT URL
      const init = await apiFetch<{ versionId: string; uploadUrl: string }>('/files/init', {
        method: 'POST',
        body: JSON.stringify({
          taskId: fileAssetId ? undefined : taskId,
          fileAssetId,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
        }),
      });
      // 2) PUT directly to storage (no app server in the path, §5.6)
      const put = await fetch(init.uploadUrl, { method: 'PUT', body: file });
      if (!put.ok) throw new Error('Upload to storage failed');
      // 3) finalize → enqueue virus scan
      await apiFetch(`/files/versions/${init.versionId}/finalize`, { method: 'POST', body: '{}' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function download(versionId: string) {
    try {
      const { url } = await apiFetch<{ url: string }>(`/files/versions/${versionId}/download`);
      window.open(url, '_blank'); // browser previews images/PDF, downloads the rest
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Download failed');
    }
  }

  async function flip(versionId: string, current: Version['visibility']) {
    const next = current === 'CLIENT_VISIBLE' ? 'INTERNAL' : 'CLIENT_VISIBLE';
    await apiFetch(`/files/versions/${versionId}/visibility`, { method: 'PUT', body: JSON.stringify({ visibility: next }) }).catch(() => undefined);
    await load();
  }

  const canUpload = CAN_UPLOAD.includes(me.role);
  const canFlip = CAN_FLIP.includes(me.role);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Files</span>
        {canUpload ? (
          <>
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
            <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
              <FileUp className="mr-1 h-3.5 w-3.5" />
              {busy ? 'Uploading…' : 'Upload'}
            </Button>
          </>
        ) : null}
      </div>
      {error ? <p className="mb-2 text-xs text-slate-900">{error}</p> : null}

      {assets.length === 0 ? (
        <p className="text-sm text-slate-400">No files attached.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {assets.map((a) => {
            const latest = a.versions[0];
            return (
              <li key={a.id} className="rounded-md border border-slate-200 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-slate-700">{a.displayName}</div>
                    <div className="text-xs text-slate-400">
                      v{latest?.versionNumber} · {fmtSize(latest?.sizeBytes ?? null)}
                      {latest?.uploadedBy ? ` · ${latest.uploadedBy.name}` : ''}
                      {a.versions.length > 1 ? ` · ${a.versions.length} versions` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {latest ? <ScanBadge status={latest.scanStatus} /> : null}
                    {latest?.visibility === 'CLIENT_VISIBLE' ? <Badge tone="blue">Client</Badge> : null}
                    {latest?.scanStatus === 'AVAILABLE' ? (
                      <button onClick={() => download(latest.id)} className="text-slate-500 hover:text-slate-800" title="Download / preview">
                        <Download className="h-4 w-4" />
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  {canFlip && latest?.scanStatus === 'AVAILABLE' ? (
                    <button onClick={() => flip(latest.id, latest.visibility)} className="text-xs text-accent hover:underline">
                      {latest.visibility === 'CLIENT_VISIBLE' ? 'Make internal' : 'Share with client'}
                    </button>
                  ) : null}
                  {canUpload ? (
                    <label className="cursor-pointer text-xs text-slate-400 hover:text-slate-600">
                      + new version
                      <input type="file" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], a.id)} />
                    </label>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
