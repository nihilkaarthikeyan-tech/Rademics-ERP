'use client';

import { useRef, useState } from 'react';
import { Button, Card, CardContent, Input } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

interface ChatResponse { text: string; citations?: string[] }
interface Turn { role: 'user' | 'assistant'; text: string; citations?: string[] }

const SUGGESTIONS = [
  'What is overdue?',
  'Who came late today?',
  'Who is free this week?',
  'What needs my approval?',
  'How are our projects going?',
];

/** Scoped AI assistant (Spec §7): read-only, cited, refuses out-of-scope. Degrades to
 *  rule-based retrieval when no provider key is configured. */
export default function AssistantPage() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setError(null);
    setBusy(true);
    setTurns((t) => [...t, { role: 'user', text: question }]);
    setQ('');
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
      <div>
        <h1 className="text-xl font-semibold text-slate-800">AI Assistant</h1>
        <p className="mt-1 text-sm text-slate-500">Ask about your projects, tasks, and team — scoped to what you can access.</p>
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
                      {t.citations.map((c, j) => <span key={j} className="text-[11px] text-slate-400">· {c}</span>)}
                    </div>
                  ) : null}
                </div>
              ))}
              <div ref={endRef} />
            </div>
          )}

          {error ? <p className="text-xs text-slate-900">{error}</p> : null}

          <form onSubmit={(e) => { e.preventDefault(); void ask(q); }} className="flex gap-2 border-t border-slate-100 pt-3">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question…" disabled={busy} />
            <Button type="submit" disabled={busy || !q.trim()}>{busy ? '…' : 'Ask'}</Button>
          </form>
          <p className="text-[11px] text-slate-400">Read-only. Answers are scoped to your access and cite the records used.</p>
        </CardContent>
      </Card>
    </div>
  );
}
