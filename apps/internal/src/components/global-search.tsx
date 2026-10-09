'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, FolderKanban, ListTodo, Megaphone, MessageSquare, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { useMe } from '@/lib/me-context';
import { navForRole } from '@/lib/nav';

interface SearchResults {
  tasks: { id: string; title: string; projectId: string; projectName: string; status: string }[];
  projects: { id: string; name: string }[];
  people: { id: string; name: string; role: string; online: boolean; email?: string }[];
  notices: { id: string; title: string; excerpt: string; createdAt: string }[];
}

const EMPTY: SearchResults = { tasks: [], projects: [], people: [], notices: [] };

const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: 'Super Admin',
  HR: 'HR',
  TEAM_LEAD: 'Team Lead',
  EMPLOYEE: 'Employee',
  FINANCE: 'Finance',
};

/**
 * Things you can DO, found by what people would type. Each points at a page
 * from the menu and only shows if that page is in your menu.
 */
const ACTIONS: { label: string; href: string; words: string }[] = [
  { label: 'Apply for leave', href: '/leave', words: 'leave holiday vacation sick day off apply request absence' },
  { label: 'My attendance', href: '/attendance', words: 'attendance hours worked idle late check in out present' },
  { label: 'Request an attendance correction', href: '/attendance', words: 'correction regularize regularization fix attendance missed forgot power cut' },
  { label: 'Message someone', href: '/chat', words: 'chat message dm talk group conversation' },
  { label: 'My tasks', href: '/my-work', words: 'tasks work todo to-do assigned my work' },
  { label: 'Company calendar and holidays', href: '/calendar', words: 'calendar holidays festival leave dates events' },
  { label: 'Download the Desktop Agent', href: '/desktop-agent', words: 'desktop app agent download install check in' },
  { label: 'Read notices', href: '/notices', words: 'notices announcements news circular' },
  { label: 'Reports', href: '/reports', words: 'reports report capacity payroll export summary' },
];

function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '·';
}

type Item = { key: string; run: () => void };

/**
 * Header search. Finds pages and actions (instantly, as you type), plus tasks,
 * projects, notices and colleagues from the server — each only within what the
 * signed-in person can already open. Ctrl+K (⌘K on a Mac) jumps here from any
 * page; arrow keys and Enter pick a result. Chat messages are searched inside
 * Chat itself, not here.
 */
export function GlobalSearch() {
  const router = useRouter();
  const me = useMe();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);

  const term = q.trim().toLowerCase();

  useEffect(() => {
    if (term.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    setLoading(true);
    // Once the text changes this reply is out of date: a slow answer for "ra"
    // must not land on top of the results for "rahul".
    let stale = false;
    const t = setTimeout(() => {
      apiFetch<SearchResults>(`/search?q=${encodeURIComponent(q.trim())}`)
        .then((r) => {
          if (!stale) setResults({ ...EMPTY, ...r });
        })
        .catch(() => {
          if (!stale) setResults(EMPTY);
        })
        .finally(() => {
          if (!stale) setLoading(false);
        });
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [q, term]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
      // Ctrl+K / ⌘K from anywhere puts the cursor in search.
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
        setOpen(true);
      }
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
    inputRef.current?.blur();
    router.push(href);
  }

  // Pages from your own menu, and actions that point at them.
  const myPages = useMemo(() => navForRole(me.role), [me.role]);
  const pageHits = useMemo(() => {
    if (!term) return [];
    const hrefs = new Set(myPages.map((p) => p.href));
    const actions = ACTIONS.filter(
      (a) => hrefs.has(a.href) && (a.label.toLowerCase().includes(term) || a.words.includes(term)),
    ).map((a) => ({ label: a.label, href: a.href }));
    const pages = myPages
      .filter((p) => p.label.toLowerCase().includes(term))
      .filter((p) => !actions.some((a) => a.label.toLowerCase() === p.label.toLowerCase()))
      .map((p) => ({ label: `Go to ${p.label}`, href: p.href }));
    return [...actions, ...pages].slice(0, 6);
  }, [term, myPages]);

  // One flat list in display order, for arrow-key navigation.
  const items: Item[] = [
    ...pageHits.map((p) => ({ key: `page-${p.label}`, run: () => go(p.href) })),
    ...results.people.map((p) => ({
      key: `person-${p.id}`,
      run: () => go(p.email ? `/people?search=${encodeURIComponent(p.name)}` : `/chat?dm=${p.id}`),
    })),
    ...results.notices.map((n) => ({ key: `notice-${n.id}`, run: () => go(`/notices?notice=${n.id}`) })),
    ...results.tasks.map((t) => ({ key: `task-${t.id}`, run: () => go(`/projects/${t.projectId}?task=${t.id}`) })),
    ...results.projects.map((p) => ({ key: `project-${p.id}`, run: () => go(`/projects/${p.id}`) })),
  ];
  const index = (key: string) => items.findIndex((i) => i.key === key);

  useEffect(() => setCursor(0), [term, results]);

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!items.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      items[cursor]?.run();
    }
  }

  const showPanel = open && term.length > 0;
  const serverPending = term.length >= 2 && loading;
  const nothing = !pageHits.length && !serverPending && !items.length;

  return (
    <div ref={rootRef} className="relative w-full max-w-xl">
      <div className="flex items-center gap-2.5 rounded-md bg-white px-3.5 py-2 text-sm text-slate-600 shadow-sm focus-within:ring-2 focus-within:ring-[#8FA7EE]">
        <Search className="h-4 w-4 shrink-0 text-slate-500" />
        <input
          ref={inputRef}
          id="global-search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKey}
          placeholder="Search pages, people, notices, tasks…"
          aria-label="Search"
          aria-expanded={showPanel}
          className="w-full bg-transparent text-slate-800 outline-none placeholder:text-slate-500"
        />
        {q ? (
          <button onClick={() => setQ('')} aria-label="Clear search" className="shrink-0 text-slate-500 hover:text-slate-600">
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd className="hidden shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-sans text-[11px] text-slate-500 md:inline">
            Ctrl K
          </kbd>
        )}
      </div>

      {showPanel ? (
        // On a phone the search box is only a sliver of the app bar, so the panel
        // spans the screen just below the bar (h-14) instead of the box's width.
        <div className="fixed inset-x-2 top-14 z-30 mt-2 max-h-[28rem] overflow-y-auto sm:absolute sm:inset-x-auto sm:left-0 sm:right-0 sm:top-full rounded-lg border border-slate-200 bg-white text-slate-900 shadow-lg">
          {nothing ? (
            <div className="p-4 text-center text-sm text-slate-500">
              {term.length < 2 ? 'Keep typing…' : <>No matches for &ldquo;{q}&rdquo;.</>}
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-slate-100">
              {pageHits.length ? (
                <ResultGroup label="Go to">
                  {pageHits.map((p) => (
                    <ResultRow
                      key={p.label}
                      active={cursor === index(`page-${p.label}`)}
                      icon={<ArrowRight className="h-4 w-4 text-slate-400" />}
                      title={p.label}
                      onClick={() => go(p.href)}
                    />
                  ))}
                </ResultGroup>
              ) : null}

              {results.people.length ? (
                <ResultGroup label="People">
                  {results.people.map((p) => (
                    <div
                      key={p.id}
                      className={`flex items-center gap-1 pr-2 ${cursor === index(`person-${p.id}`) ? 'bg-slate-50' : ''}`}
                    >
                      <button
                        onClick={() => go(p.email ? `/people?search=${encodeURIComponent(p.name)}` : `/chat?dm=${p.id}`)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-3.5 py-2 text-left text-sm hover:bg-slate-50"
                      >
                        <span className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">
                          {initials(p.name)}
                          {p.online ? (
                            <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-success ring-2 ring-white" />
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate font-medium text-slate-700">{p.name}</span>
                          <span className="block truncate text-xs text-slate-500">
                            {ROLE_LABELS[p.role] ?? p.role} · {p.online ? 'Online now' : 'Offline'}
                            {p.email ? ` · ${p.email}` : ''}
                          </span>
                        </span>
                      </button>
                      {p.id !== me.id ? (
                        <button
                          onClick={() => go(`/chat?dm=${p.id}`)}
                          title={`Message ${p.name}`}
                          aria-label={`Message ${p.name}`}
                          className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-accent-soft hover:text-accent"
                        >
                          <MessageSquare className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </ResultGroup>
              ) : null}

              {results.notices.length ? (
                <ResultGroup label="Notices">
                  {results.notices.map((n) => (
                    <ResultRow
                      key={n.id}
                      active={cursor === index(`notice-${n.id}`)}
                      icon={<Megaphone className="h-4 w-4 text-slate-400" />}
                      title={n.title}
                      subtitle={n.excerpt}
                      onClick={() => go(`/notices?notice=${n.id}`)}
                    />
                  ))}
                </ResultGroup>
              ) : null}

              {results.tasks.length ? (
                <ResultGroup label="Tasks">
                  {results.tasks.map((t) => (
                    <ResultRow
                      key={t.id}
                      active={cursor === index(`task-${t.id}`)}
                      icon={<ListTodo className="h-4 w-4 text-slate-400" />}
                      title={t.title}
                      subtitle={`${t.projectName} · ${t.status.replace(/_/g, ' ').toLowerCase()}`}
                      onClick={() => go(`/projects/${t.projectId}?task=${t.id}`)}
                    />
                  ))}
                </ResultGroup>
              ) : null}

              {results.projects.length ? (
                <ResultGroup label="Projects">
                  {results.projects.map((p) => (
                    <ResultRow
                      key={p.id}
                      active={cursor === index(`project-${p.id}`)}
                      icon={<FolderKanban className="h-4 w-4 text-slate-400" />}
                      title={p.name}
                      onClick={() => go(`/projects/${p.id}`)}
                    />
                  ))}
                </ResultGroup>
              ) : null}

              {serverPending ? <div className="px-3.5 py-2.5 text-xs text-slate-500">Searching…</div> : null}
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
      <div className="px-3.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      {children}
    </div>
  );
}

function ResultRow({
  icon,
  title,
  subtitle,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm hover:bg-slate-50 ${active ? 'bg-slate-50' : ''}`}
    >
      {icon}
      <div className="min-w-0">
        <div className="truncate font-medium text-slate-700">{title}</div>
        {subtitle ? <div className="truncate text-xs text-slate-500">{subtitle}</div> : null}
      </div>
    </button>
  );
}
