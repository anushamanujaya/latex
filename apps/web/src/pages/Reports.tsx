import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, HandCoins, PackageOpen, Printer, Scale, Truck } from 'lucide-react';
import { api, kg, litres, money } from '../lib/api';

type Report = {
  range: { from: string; to: string };
  purchases: { count: number; litresMilli: number; kgMilli: number; procurementCents: number; cashPaidCents: number; outstandingCents: number };
  dispatches: { count: number; acquiredKgMilli: number; acceptedKgMilli: number; revenueCents: number; netProfitCents: number };
  expenses: { count: number; amountCents: number };
  invoices: { count: number; invoicedCents: number; outstandingCents: number; refundDueCents: number };
  positions: { supplierPayableCents: number; supplierAdvanceCents: number; buyerReceivableCents: number };
};

const dateValue = (date: Date) => date.toISOString().slice(0, 10);

export function Reports() {
  const today = dateValue(new Date());
  const monthStart = dateValue(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [range, setRange] = useState({ from: monthStart, to: today });
  const report = useQuery({ queryKey: ['reports-summary', range], queryFn: () => api<{ data: Report }>(`/reports/summary?from=${encodeURIComponent(`${range.from}T00:00:00+05:30`)}&to=${encodeURIComponent(`${range.to}T23:59:59.999+05:30`)}`) });
  const data = report.data?.data;
  function apply(event: FormEvent) { event.preventDefault(); setRange({ from, to }); }
  const metrics = [
    ['Purchases', String(data?.purchases.count ?? 0), data ? litres(data.purchases.litresMilli) : 'Collection volume', PackageOpen],
    ['Purchased weight', data ? kg(data.purchases.kgMilli) : '—', 'Calculated KG', Scale],
    ['Procurement cost', data ? money(data.purchases.procurementCents) : '—', 'Purchase value', HandCoins],
    ['Dispatches', String(data?.dispatches.count ?? 0), data ? kg(data.dispatches.acquiredKgMilli) : 'Dispatched KG', Truck],
    ['Sales revenue', data ? money(data.dispatches.revenueCents) : '—', 'Reconciled dispatch revenue', BarChart3],
    ['Net batch profit', data ? money(data.dispatches.netProfitCents) : '—', 'After direct expenses', BarChart3],
  ] as const;

  return <div>
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-medium text-emerald-800">Operational and financial analysis</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Reports & Analytics</h1><p className="mt-2 text-sm text-stone-500">Period activity with current supplier and buyer positions.</p></div><button className="btn-secondary" onClick={() => window.print()}><Printer size={17}/>Print report</button></div>
    <form className="card mb-5 flex flex-wrap items-end gap-4 p-5" onSubmit={apply}><label><span className="label">From</span><input className="input" type="date" required value={from} onChange={(event) => setFrom(event.target.value)}/></label><label><span className="label">To</span><input className="input" type="date" required min={from} value={to} onChange={(event) => setTo(event.target.value)}/></label><button className="btn-primary" disabled={report.isFetching}>{report.isFetching ? 'Loading…' : 'Run report'}</button></form>
    {report.isError && <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">The report could not be loaded.</div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(([title, value, note, Icon]) => <div className="card p-5" key={title}><div className="flex justify-between gap-3"><div><p className="text-sm text-stone-500">{title}</p><p className="tabular mt-2 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-stone-400">{note}</p></div><div className="grid size-10 place-items-center rounded-xl bg-emerald-50 text-emerald-800"><Icon size={20}/></div></div></div>)}</section>
    <div className="mt-5 grid gap-5 xl:grid-cols-2"><section className="card overflow-hidden"><div className="border-b border-stone-200 p-5"><h2 className="font-semibold">Period financial activity</h2></div><dl className="divide-y divide-stone-100 text-sm"><ReportRow label="Cash paid to suppliers" value={money(data?.purchases.cashPaidCents ?? 0)}/><ReportRow label="Purchase balances outstanding" value={money(data?.purchases.outstandingCents ?? 0)}/><ReportRow label={`Expenses (${data?.expenses.count ?? 0})`} value={money(data?.expenses.amountCents ?? 0)}/><ReportRow label={`Company invoices (${data?.invoices.count ?? 0})`} value={money(data?.invoices.invoicedCents ?? 0)}/><ReportRow label="Invoice balances outstanding" value={money(data?.invoices.outstandingCents ?? 0)}/><ReportRow label="Company refunds due" value={money(data?.invoices.refundDueCents ?? 0)}/></dl></section><section className="card overflow-hidden"><div className="border-b border-stone-200 p-5"><h2 className="font-semibold">Current ledger positions</h2><p className="mt-1 text-xs text-stone-500">Balances at present, independent of the selected report period.</p></div><dl className="divide-y divide-stone-100 text-sm"><ReportRow label="Supplier payable ledger" value={money(data?.positions.supplierPayableCents ?? 0)}/><ReportRow label="Supplier advance ledger" value={money(data?.positions.supplierAdvanceCents ?? 0)}/><ReportRow label="Net supplier position" value={money((data?.positions.supplierPayableCents ?? 0) - (data?.positions.supplierAdvanceCents ?? 0))}/><ReportRow label="Buyer receivable ledger" value={money(data?.positions.buyerReceivableCents ?? 0)}/><ReportRow label="Accepted dispatch weight" value={kg(data?.dispatches.acceptedKgMilli ?? 0)}/></dl></section></div>
  </div>;
}

function ReportRow({ label, value }: { label: string; value: string }) { return <div className="flex items-center justify-between gap-4 px-5 py-4"><dt className="text-stone-600">{label}</dt><dd className="tabular font-semibold">{value}</dd></div>; }
