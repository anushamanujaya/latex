import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';

type Entry = { _id: string; createdAt: string; action: string; entityType?: string; entityId?: string; actorId?: { name: string; role: string }; reason?: string; before?: unknown; after?: unknown };

export function FinancialAudit() {
  const query = useQuery({ queryKey: ['financial-audit'], queryFn: () => api<{ data: Entry[] }>('/audit?limit=200') });
  return <div><h1 className="text-3xl font-semibold">Financial audit history</h1><p className="mt-2 text-sm text-stone-500">Most recent 200 recorded actions. Source financial records remain available in their respective histories.</p>{query.isLoading && <p className="mt-5">Loading audit history…</p>}{query.isError && <p role="alert" className="mt-5 text-red-700">Audit history could not be loaded.</p>}<div className="mt-5 space-y-3">{query.data?.data.map(entry => <details key={entry._id} className="card p-4 text-sm"><summary className="cursor-pointer font-medium">{new Date(entry.createdAt).toLocaleString('en-LK')} · {entry.action} · {entry.actorId?.name ?? 'Unknown actor'}</summary><div className="mt-3 grid gap-2 sm:grid-cols-2"><div>Entity: {entry.entityType} {entry.entityId}</div><div>Reason: {entry.reason ?? 'Not recorded'}</div></div><pre className="mt-3 overflow-auto rounded-lg bg-stone-50 p-3 text-xs">{JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}</pre></details>)}</div></div>;
}
