import { useQuery } from '@tanstack/react-query';
import { PackageOpen, RefreshCw, Scale, WalletCards } from 'lucide-react';
import { api, kg, litres, money } from '../lib/api';

type Purchase = { _id: string; billNumber: string; sequence: number; eventAt: string; supplierId: { code: string; name: string }; litresMilli: number; kgMilli: number; totalCents: number };
type InventoryResponse = { data: { litresMilli: number; kgMilli: number; purchaseCostCents: number; purchaseCount: number }; purchases: Purchase[] };

export function Inventory() {
  const query = useQuery({ queryKey: ['inventory'], queryFn: () => api<InventoryResponse>('/inventory') });
  const summary = query.data?.data;
  const metrics = [
    ['Pending volume', summary ? litres(summary.litresMilli) : '—', 'Undispatched latex', PackageOpen],
    ['Calculated weight', summary ? kg(summary.kgMilli) : '—', 'Acquired inventory weight', Scale],
    ['Historical cost', summary ? money(summary.purchaseCostCents) : '—', 'Purchase cost carried forward', WalletCards],
    ['Purchase records', String(summary?.purchaseCount ?? 0), 'Pending sequence records', PackageOpen],
  ] as const;

  return <div>
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-emerald-800">Pending stock position</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Inventory</h1><p className="mt-2 text-sm text-stone-500">Purchases not yet assigned to a confirmed bowser dispatch.</p></div><button className="btn-secondary" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw size={17}/>{query.isFetching ? 'Refreshing…' : 'Refresh'}</button></div>
    {query.isError && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Inventory could not be loaded.</div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(([title, value, note, Icon]) => <div className="card p-5" key={title}><div className="flex justify-between gap-3"><div><p className="text-sm text-stone-500">{title}</p><p className="tabular mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-stone-400">{note}</p></div><div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><Icon size={20}/></div></div></div>)}</section>
    <section className="card mt-5 overflow-hidden"><div className="border-b border-stone-200 p-5"><h2 className="font-semibold">Pending purchase sequence</h2><p className="mt-1 text-xs text-stone-500">These records form the next dispatch boundary.</p></div><div className="overflow-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-5 py-3">Sequence</th><th className="px-5 py-3">Purchase</th><th className="px-5 py-3">Supplier</th><th className="px-5 py-3">Collected</th><th className="px-5 py-3 text-right">Litres</th><th className="px-5 py-3 text-right">KG</th><th className="px-5 py-3 text-right">Cost</th></tr></thead><tbody>{query.data?.purchases.map((purchase) => <tr className="border-t border-stone-100" key={purchase._id}><td className="px-5 py-4 font-semibold">{purchase.sequence}</td><td className="px-5 py-4 text-emerald-900">{purchase.billNumber}</td><td className="px-5 py-4"><div>{purchase.supplierId.name}</div><div className="text-xs text-stone-400">{purchase.supplierId.code}</div></td><td className="px-5 py-4 text-stone-600">{new Date(purchase.eventAt).toLocaleString('en-LK', { dateStyle: 'medium', timeStyle: 'short' })}</td><td className="tabular px-5 py-4 text-right">{litres(purchase.litresMilli)}</td><td className="tabular px-5 py-4 text-right">{kg(purchase.kgMilli)}</td><td className="tabular px-5 py-4 text-right font-medium">{money(purchase.totalCents)}</td></tr>)}</tbody></table></div>{!query.isLoading && !query.data?.purchases.length && <div className="p-10 text-center text-sm text-stone-500">No pending inventory. All purchases have been dispatched.</div>}</section>
  </div>;
}
