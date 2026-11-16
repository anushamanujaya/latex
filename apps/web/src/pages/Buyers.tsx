import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import { api, money } from '../lib/api';

type Buyer = { _id: string; name: string; contact?: string; address?: string; settlementTerms?: string; active: boolean };
type Entry = { _id: string; eventAt: string; type: string; receivableDeltaCents: number; receivableBalanceCents: number; referenceType: string; description?: string };
type Statement = { data: Entry[]; summary: { receivableCents: number } };
type Session = { user: { role: string } };

export function Buyers() {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ name: '', contact: '', address: '', settlementTerms: '' });
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<Session>('/auth/me') });
  const buyers = useQuery({ queryKey: ['buyers'], queryFn: () => api<{ data: Buyer[] }>('/buyers') });
  const statement = useQuery({ queryKey: ['buyer-statement', selectedId], enabled: Boolean(selectedId), queryFn: () => api<Statement>(`/buyers/${selectedId}/statement`) });
  const canCreate = ['ADMIN', 'MANAGER'].includes(session.data?.user.role ?? '');
  const create = useMutation({
    mutationFn: () => api<{ data: Buyer }>('/buyers', { method: 'POST', body: JSON.stringify({ name: form.name.trim(), contact: form.contact.trim() || undefined, address: form.address.trim() || undefined, settlementTerms: form.settlementTerms.trim() || undefined }) }),
    onSuccess: async ({ data }) => { setForm({ name: '', contact: '', address: '', settlementTerms: '' }); setShowForm(false); setError(''); setMessage('Buyer company registered.'); setSelectedId(data._id); await queryClient.invalidateQueries({ queryKey: ['buyers'] }); },
    onError: (cause) => { setMessage(''); setError(cause instanceof Error ? cause.message : 'Could not register buyer'); },
  });
  function submit(event: FormEvent) { event.preventDefault(); setError(''); setMessage(''); create.mutate(); }
  const selected = buyers.data?.data.find((buyer) => buyer._id === selectedId);

  return <div>
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-emerald-800">Company relationships</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Buyers / Companies</h1><p className="mt-2 text-sm text-stone-500">Manage latex buyers and inspect each company receivable statement.</p></div>{canCreate && <button className="btn-primary" onClick={() => setShowForm((value) => !value)}><Plus size={17}/>Register buyer</button>}</div>
    {message && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{message}</div>}{error && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
    {showForm && <form className="card mb-5 grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-5" onSubmit={submit}><label><span className="label">Company name</span><input className="input" required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })}/></label><label><span className="label">Contact</span><input className="input" value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })}/></label><label><span className="label">Address</span><input className="input" value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })}/></label><label><span className="label">Settlement terms</span><input className="input" value={form.settlementTerms} onChange={(event) => setForm({ ...form, settlementTerms: event.target.value })} placeholder="14 days"/></label><button className="btn-primary self-end" disabled={create.isPending}>{create.isPending ? 'Saving…' : 'Save buyer'}</button></form>}
    <div className="grid gap-5 xl:grid-cols-[.75fr_1.25fr]"><section className="card overflow-hidden"><div className="border-b border-stone-200 p-5"><h2 className="font-semibold">Active buyers</h2></div><div className="divide-y divide-stone-100">{buyers.data?.data.map((buyer) => <button className={`flex w-full items-start gap-3 p-4 text-left transition hover:bg-stone-50 ${selectedId === buyer._id ? 'bg-emerald-50/70' : ''}`} key={buyer._id} onClick={() => setSelectedId(buyer._id)}><div className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><Building2 size={19}/></div><div><div className="font-medium">{buyer.name}</div><div className="mt-1 text-xs text-stone-500">{buyer.contact || 'No contact'}{buyer.settlementTerms ? ` · ${buyer.settlementTerms}` : ''}</div></div></button>)}</div>{!buyers.isLoading && !buyers.data?.data.length && <div className="p-8 text-center text-sm text-stone-500">No buyers registered.</div>}</section>
      <section className="card overflow-hidden">{selected ? <><div className="flex flex-wrap items-end justify-between gap-3 border-b border-stone-200 p-5"><div><h2 className="font-semibold">{selected.name}</h2><p className="mt-1 text-xs text-stone-500">{selected.address || 'No address recorded'}</p></div><div className="text-right"><p className="text-xs text-stone-500">Receivable balance</p><p className="tabular mt-1 text-xl font-semibold">{statement.data ? money(statement.data.summary.receivableCents) : '—'}</p></div></div><div className="overflow-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Entry</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3 text-right">Change</th><th className="px-4 py-3 text-right">Balance</th></tr></thead><tbody>{statement.data?.data.map((entry) => <tr className="border-t border-stone-100" key={entry._id}><td className="px-4 py-4 text-stone-600">{new Date(entry.eventAt).toLocaleString('en-LK')}</td><td className="px-4 py-4"><div>{entry.type.replaceAll('_', ' ')}</div>{entry.description && <div className="text-xs text-stone-400">{entry.description}</div>}</td><td className="px-4 py-4 text-stone-500">{entry.referenceType}</td><td className="tabular px-4 py-4 text-right">{money(entry.receivableDeltaCents)}</td><td className="tabular px-4 py-4 text-right font-medium">{money(entry.receivableBalanceCents)}</td></tr>)}</tbody></table></div>{!statement.isLoading && !statement.data?.data.length && <div className="p-10 text-center text-sm text-stone-500">No company ledger entries yet.</div>}</> : <div className="grid min-h-72 place-items-center p-8 text-center text-sm text-stone-500">Select a buyer to view its receivable statement.</div>}</section></div>
  </div>;
}
