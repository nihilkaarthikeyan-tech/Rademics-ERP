'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FolderKanban, ListTodo, Search, User, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';

interface SearchResults {
  tasks: { id: string; title: string; projectId: string; projectName: string; status: string }[];
  projects: { id: string; name: string }[];
  people: { id: string; name: string; email: string; role: string }[];
}

const EMPTY: SearchResults = { tasks: [], projects: [], people: [] };

/** Header global search (2026-07-24) — was a decorative box with no function before. */
export function GlobalSearch() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(EMPTY);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      apiFetch<SearchResults>(`/search?q=${encodeURIComponent(q.trim())}`)
        .then(setResults)
        .catch(() => setResults(EMPTY))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  function go(href: string) {
    setOpen(false);
    setQ('');
    router.push(href);
  }

  const hasQuery = q.trim().length >= 2;
  const hasResults = results.tasks.length || results.projects.length || results.people.length;

  return (
    <div ref={rootRef} className="relative w-full max-w-sm">
      <div className="flex items-center gap-2 rounded-xl border border-white/60 bg-white/60 px-3.5 py-2 text-sm text-slate-500 focus-within:border-accent focus-within:ring-2 focus-within:ring-accent">
        <Search className="h-4 w-4 shrink-0 text-slate-400" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => setOpen(true)}
          placeholder="Search tasks, projects, people…"
          className="w-full bg-transparent text-slate-700 outline-none placeholder:text-slate-400"
        />
        {q ? (
          <button onClick={() => setQ('')} aria-label="Clear search" className="shrink-0 text-slate-400 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>

      {open && hasQuery ? (
        <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-96 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {loading ? (
            <div className="p-4 text-center text-sm text-slate-400">Searching…</div>
          ) : !hasResults ? (
            <div className="p-4 text-center text-sm text-slate-400">No matches for &ldquo;{q}&rdquo;.</div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100">
              {results.tasks.length ? (
                <ResultGroup label="Tasks">
                  {results.tasks.map((t) => (
                    <ResultRow
                      key={t.id}
                      icon={<ListTodo className="h-4 w-4 text-slate-400" />}
                      title={t.title}
                      subtitle={`${t.projectName} · ${t.status}`}
                      onClick={() => go(`/projects/${t.projectId}`)}
                    />
                  ))}
                </ResultGroup>
              ) : null}
              {results.projects.length ? (
                <ResultGroup label="Projects">
                  {results.projects.map((p) => (
                    <ResultRow
                      key={p.id}
                      icon={<FolderKanban className="h-4 w-4 text-slate-400" />}
                      title={p.name}
                      onClick={() => go(`/projects/${p.id}`)}
                    />
                  ))}
                </ResultGroup>
              ) : null}
              {results.people.length ? (
                <ResultGroup label="People">
                  {results.people.map((p) => (
                    <ResultRow
                      key={p.id}
                      icon={<User className="h-4 w-4 text-slate-400" />}
                      title={p.name}
                      subtitle={p.email}
                      onClick={() => go(`/people?search=${encodeURIComponent(p.name)}`)}
                    />
                  ))}
                </ResultGroup>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ResultGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-1.5">
      <div className="px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      {children}
    </div>
  );
}

function ResultRow({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm hover:bg-slate-50"
    >
      {icon}
      <div className="min-w-0">
        <div className="truncate font-medium text-slate-700">{title}</div>
        {subtitle ? <div className="truncate text-xs text-slate-400">{subtitle}</div> : null}
      </div>
    </button>
  );
}
