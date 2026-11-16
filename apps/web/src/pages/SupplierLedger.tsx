import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, HandCoins, Landmark } from 'lucide-react';
import { api, money } from '../lib/api';

type Supplier = { _id: string; code: string; name: string };
type Entry = { _id: string; eventAt: string; type: string; payableDeltaCents: number; advanceDeltaCents: number; payableBalanceCents: number; advanceBalanceCents: number; description?: string; referenceType: string };
type Statement = { data: Entry[]; summary: { payableCents: number; advanceCents: number; netPositionCents: number } };

export function SupplierLedger() {
  const [supplierId, setSupplierId] = useState('');
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<{ data: Supplier[] }>('/suppliers') });
  const statement = useQuery({ queryKey: ['supplier-statement', supplierId], enabled: Boolean(supplierId), queryFn: () => api<Statement>(`/suppliers/${supplierId}/statement`) });
  const selected = suppliers.data?.data.find((supplier) => supplier._id === supplierId);
  const summary = statement.data?.summary;

  return <div>
    <div className="mb-7"><p className="text-sm font-medium text-emerald-800">Supplier financial history</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Supplier ledger</h1><p className="mt-2 text-sm text-stone-500">Running purchase obligations, payments and supplier advances.</p></div>
    <section className="card mb-5 p-5"><label className="block max-w-xl"><span className="label">Supplier</span><select className="input" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}><option value="">Select a supplier…</option>{suppliers.data?.data.map((supplier) => <option key={supplier._id} value={supplier._id}>{supplier.code} · {supplier.name}</option>)}</select></label></section>
    {supplierId && <>
      {statement.isError && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Supplier statement could not be loaded.</div>}
      <section className="grid gap-4 sm:grid-cols-3"><div className="card p-5"><div className="flex justify-between"><div><p className="text-sm text-stone-500">Payable balance</p><p className="tabular mt-2 text-2xl font-semibold">{summary ? money(summary.payableCents) : '—'}</p></div><HandCoins className="text-emerald-700" size={22}/></div></div><div className="card p-5"><div className="flex justify-between"><div><p className="text-sm text-stone-500">Advance balance</p><p className="tabular mt-2 text-2xl font-semibold">{summary ? money(summary.advanceCents) : '—'}</p></div><Landmark className="text-emerald-700" size={22}/></div></div><div className="card p-5"><div className="flex justify-between"><div><p className="text-sm text-stone-500">Net position</p><p className="tabular mt-2 text-2xl font-semibold">{summary ? money(summary.netPositionCents) : '—'}</p></div><ClipboardList className="text-emerald-700" size={22}/></div></div></section>
      <section className="card mt-5 overflow-hidden"><div className="border-b border-stone-200 p-5"><h2 className="font-semibold">{selected?.name} statement</h2><p className="mt-1 text-xs text-stone-500">Entries are shown in ledger order with running balances.</p></div><div className="overflow-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-4 py-3">Date</th><th className="px-4 py-3">Entry</th><th className="px-4 py-3">Reference</th><th className="px-4 py-3 text-right">Payable change</th><th className="px-4 py-3 text-right">Advance change</th><th className="px-4 py-3 text-right">Payable balance</th><th className="px-4 py-3 text-right">Advance balance</th></tr></thead><tbody>{statement.data?.data.map((entry) => <tr className="border-t border-stone-100" key={entry._id}><td className="px-4 py-4 text-stone-600">{new Date(entry.eventAt).toLocaleString('en-LK')}</td><td className="px-4 py-4"><div className="font-medium">{entry.type.replaceAll('_', ' ')}</div>{entry.description && <div className="text-xs text-stone-400">{entry.description}</div>}</td><td className="px-4 py-4 text-stone-500">{entry.referenceType}</td><td className="tabular px-4 py-4 text-right">{money(entry.payableDeltaCents)}</td><td className="tabular px-4 py-4 text-right">{money(entry.advanceDeltaCents)}</td><td className="tabular px-4 py-4 text-right font-medium">{money(entry.payableBalanceCents)}</td><td className="tabular px-4 py-4 text-right font-medium">{money(entry.advanceBalanceCents)}</td></tr>)}</tbody></table></div>{!statement.isLoading && !statement.data?.data.length && <div className="p-10 text-center text-sm text-stone-500">This supplier has no ledger entries yet.</div>}</section>
    </>}
    {!supplierId && <div className="card grid min-h-52 place-items-center p-8 text-center text-sm text-stone-500">Select a supplier to view the full statement.</div>}
  </div>;
}
