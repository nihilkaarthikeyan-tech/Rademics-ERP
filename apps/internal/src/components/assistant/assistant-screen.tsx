'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { Button, Card, CardContent, Input } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';
import { useMe } from '@/lib/me-context';

interface ChatResponse { text: string; citations?: string[] }
interface Turn { role: 'user' | 'assistant'; text: string; citations?: string[] }

/**
 * What the waiting bubble says, in order.
 *
 * An answer takes a few seconds because the assistant is fetching real records
 * before it replies. A silent gap reads as "broken"; naming the stage reads as
 * "working". These are honest descriptions of what is happening, not padding to
 * make it feel busy.
 */
const WAIT_STAGES = [
  { after: 0, text: 'Reading your question…' },
  { after: 1200, text: 'Looking up your records…' },
  { after: 4000, text: 'Checking a few more things…' },
  { after: 9000, text: 'Still working — nearly there…' },
];

/** Kept per person: one browser, several logins should not share a thread. */
const storageKey = (userId: string) => `assistant:thread:${userId}`;

const SUGGESTIONS = [
  'What is overdue?',
  'Who came late today?',
  'Who is free this week?',
  'What needs my approval?',
  'How are our projects going?',
];

/** Scoped AI assistant (Spec §7): read-only, cited, refuses out-of-scope. Degrades to
 *  rule-based retrieval when no provider key is configured. */
/** The AI Assistant screen. Hidden for now (see lib/nav.ts); app/(app)/assistant/page.tsx redirects. */
export function AssistantScreen() {
  const me = useMe();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState(WAIT_STAGES[0]!.text);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Deliberately state, not a ref. With a ref the save effect ran in the SAME
  // commit as the restore — the flag was already true but `turns` was still the
  // empty initial value, so it wrote [] straight over the thread it had just
  // loaded. As state, the save effect first runs on the re-render that carries
  // the restored turns.
  const [restored, setRestored] = useState(false);

  // Restore the thread on load. A refresh, a stray click, or coming back after
  // lunch should not lose the conversation — losing it silently is the thing
  // that teaches people not to rely on the assistant.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(storageKey(me.id));
      if (raw) setTurns(JSON.parse(raw) as Turn[]);
    } catch {
      /* unreadable or disabled storage just means starting fresh */
    }
    setRestored(true);
  }, [me.id]);

  useEffect(() => {
    if (!restored) return;
    try {
      window.sessionStorage.setItem(storageKey(me.id), JSON.stringify(turns.slice(-40)));
    } catch {
      /* over quota / private mode — the conversation still works in memory */
    }
  }, [turns, restored, me.id]);

  const clearThread = useCallback(() => {
    setTurns([]);
    setError(null);
    try {
      window.sessionStorage.removeItem(storageKey(me.id));
    } catch {
      /* nothing to clear */
    }
  }, [me.id]);

  // Walk the waiting message forward while a request is in flight.
  useEffect(() => {
    if (!busy) return;
    setStage(WAIT_STAGES[0]!.text);
    const timers = WAIT_STAGES.slice(1).map((s) =>
      window.setTimeout(() => setStage(s.text), s.after),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [busy]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setError(null);
    setBusy(true);
    setTurns((t) => [...t, { role: 'user', text: question }]);
    setQ('');
    setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    try {
      // Send the conversation so far, so follow-ups like "what about the
      // others?" resolve against what was just asked.
      const res = await apiFetch<ChatResponse>('/ai/chat', {
        method: 'POST',
        body: JSON.stringify({
          question,
          history: turns.slice(-8).map((t) => ({ role: t.role, content: t.text })),
        }),
      });
      setTurns((t) => [...t, { role: 'assistant', text: res.text, citations: res.citations }]);
    } catch (err) {
      // Raw server/validation messages read like errors in a chat — keep it human.
      const msg =
        err instanceof ApiError && err.status === 429
          ? 'Daily AI limit reached. Try again tomorrow.'
          : "Sorry, I couldn't process that — try rephrasing your question.";
      setError(msg);
    } finally {
      setBusy(false);
      setTimeout(() => endRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">AI Assistant</h1>
          <p className="mt-1 text-sm text-slate-500">Ask about your projects, tasks, and team — scoped to what you can access.</p>
        </div>
        {turns.length > 0 ? (
          <button
            onClick={clearThread}
            className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 shadow-glass hover:text-slate-800"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear conversation
          </button>
        ) : null}
      </div>

      <Card className="mt-4">
        <CardContent className="flex flex-col gap-3 pt-5">
          {turns.length === 0 ? (
            <div className="flex flex-col gap-2 py-6 text-center">
              <p className="text-sm text-slate-500">Try one of these:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} onClick={() => ask(s)} className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50">{s}</button>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {turns.map((t, i) => (
                <div key={i} className={t.role === 'user' ? 'self-end' : 'self-start'}>
                  <div className={`max-w-md rounded-lg px-3 py-2 text-sm ${t.role === 'user' ? 'bg-accent text-white' : 'bg-slate-100 text-slate-700'}`}>
                    {t.text}
                  </div>
                  {/* How the answer was produced is our concern, not the reader's —
                      only the records it drew on are shown. */}
                  {t.role === 'assistant' && t.citations?.length ? (
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      {t.citations.map((c, j) => <span key={j} className="text-[11px] text-slate-500">· {c}</span>)}
                    </div>
                  ) : null}
                </div>
              ))}

              {/* The waiting bubble. Sits where the answer will appear, so the
                  eye does not have to hunt for the reply when it arrives. */}
              {busy ? (
                <div className="self-start">
                  <div className="flex max-w-md items-center gap-2.5 rounded-lg bg-slate-100 px-3 py-2">
                    <span className="flex gap-1" aria-hidden="true">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                    </span>
                    <span className="text-sm text-slate-500">{stage}</span>
                  </div>
                </div>
              ) : null}

              <div ref={endRef} />
            </div>
          )}

          {/* Waiting on the very first question, before any bubbles exist. */}
          {busy && turns.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-2 text-sm text-slate-500">
              <span className="flex gap-1" aria-hidden="true">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.3s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:-0.15s]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
              </span>
              {stage}
            </div>
          ) : null}

          {error ? <p className="text-xs text-slate-900">{error}</p> : null}

          <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} className="flex gap-2 border-t border-slate-100 pt-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question…" disabled={busy} />
            <Button type="submit" disabled={busy || !q.trim()}>{busy ? '…' : 'Ask'}</Button>
          </form>
          <p className="text-[11px] text-slate-500">Read-only. Answers are scoped to your access and cite the records used.</p>
        </CardContent>
      </Card>
    </div>
  );
}
