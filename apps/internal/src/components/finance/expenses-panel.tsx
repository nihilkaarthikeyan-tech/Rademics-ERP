'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Label, LoadingState } from '@rademics/ui';
import { apiFetch, ApiError } from '@/lib/api';

interface Project { id: string; name: string }
interface Expense { id: string; category: string; amount: string; spentAt: string; description: string | null }

const CATEGORIES = ['Freelancer Payout', 'Tool Subscription', 'Travel', 'Other'];
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

/** Project expenses (Spec §5.8): log per project with category + amount. */
export function ExpensesPanel() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [amount, setAmount] = useState('');
  const [spentAt, setSpentAt] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [rows, setRows] = useState<Expense[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Project[]>('/projects').then((ps) => {
      setProjects(ps);
      if (ps[0]) setProjectId(ps[0].id);
    }).catch(() => setProjects([]));
  }, []);

  const load = useCallback(async () => {
    if (!projectId) return;
    try {
      setRows(await apiFetch<Expense[]>(`/finance/expenses/project/${projectId}`));
    } catch {
      setRows([]);
    }
  }, [projectId]);
  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/finance/expenses', { method: 'POST', body: JSON.stringify({ projectId, category, amount: Number(amount), spentAt, description: description || undefined }) });
      setAmount('');
      setDescription('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not log expense');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader><CardTitle>Log an expense</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="exp-proj">Project</Label>
                <select id="exp-proj" value={projectId} onChange={(e) => setProjectId(e.target.value)} className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="exp-cat">Category</Label>
                <select id="exp-cat" value={category} onChange={(e) => setCategory(e.target.value)} className="flex h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm">
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <Label htmlFor="exp-amt">Amount (₹)</Label>
                <Input id="exp-amt" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="exp-date">Date</Label>
                <Input id="exp-date" type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)} required />
              </div>
            </div>
            <div>
              <Label htmlFor="exp-desc">Description (optional)</Label>
              <Input id="exp-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={!projectId}>Log expense</Button>
              {error ? <span className="text-xs text-slate-900">{error}</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Expenses for this project</CardTitle></CardHeader>
        <CardContent>
          {rows === null ? (
            <LoadingState />
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No expenses logged for this project.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {rows.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <span className="font-medium text-slate-700">{e.category}</span>
                    <span className="ml-2 text-xs text-slate-500">{e.spentAt.slice(0, 10)}</span>
                    {e.description ? <div className="text-xs text-slate-500">{e.description}</div> : null}
                  </div>
                  <span className="tabular-nums text-slate-700">{inr(Number(e.amount))}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
