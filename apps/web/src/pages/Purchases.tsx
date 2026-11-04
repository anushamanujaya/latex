import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Printer, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, kg, litres, money } from '../lib/api';

type Purchase={_id:string;billNumber:string;eventAt:string;sequence:number;supplierId:{code:string;name:string};litresMilli:number;kgMilli:number;totalCents:number;outstandingCents:number;paymentStatus:string;dispatchStatus:string};
const statusStyle:Record<string,string>={PAID:'bg-emerald-50 text-emerald-700',UNPAID:'bg-red-50 text-red-700',PARTIALLY_PAID:'bg-amber-50 text-amber-700'};

export function Purchases(){
  const [search,setSearch]=useState('');
  const [status,setStatus]=useState('ALL');
  const query=useQuery({queryKey:['purchases'],queryFn:()=>api<{data:Purchase[];pagination:{total:number}}>('/purchases?limit=100')});
  const shown=query.data?.data.filter(p=>(status==='ALL'||p.paymentStatus===status)&&`${p.billNumber} ${p.supplierId.name} ${p.supplierId.code}`.toLowerCase().includes(search.toLowerCase()))??[];
  return <div><div className="mb-7"><p className="text-sm font-medium text-emerald-800">Immutable purchase register</p><h1 className="mt-1 text-3xl font-semibold tracking-tight">Purchase history</h1></div>
    <div className="card overflow-hidden"><div className="flex flex-wrap gap-3 border-b border-stone-200 p-4"><div className="relative min-w-64 flex-1"><Search className="absolute left-3 top-2.5 text-stone-400" size={18}/><input className="input py-2 pl-10" placeholder="Bill or supplier…" value={search} onChange={e=>setSearch(e.target.value)}/></div><select className="input w-auto py-2" value={status} onChange={e=>setStatus(e.target.value)}><option value="ALL">All payment statuses</option><option value="PAID">Paid</option><option value="UNPAID">Unpaid</option><option value="PARTIALLY_PAID">Partially paid</option></select></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr>{['Bill / Sequence','Event time','Supplier','Volume','Weight','Total','Settlement','Dispatch','Actions'].map(h=><th className="px-5 py-3 font-semibold" key={h}>{h}</th>)}</tr></thead><tbody>{shown.map(p=><tr className="border-t border-stone-100 hover:bg-stone-50/70" key={p._id}><td className="px-5 py-4"><div className="font-semibold text-emerald-900">{p.billNumber}</div><div className="text-xs text-stone-400">SEQ {p.sequence}</div></td><td className="px-5 py-4 text-stone-600">{new Date(p.eventAt).toLocaleString('en-LK',{dateStyle:'medium',timeStyle:'short'})}</td><td className="px-5 py-4"><div className="font-medium">{p.supplierId.name}</div><div className="text-xs text-stone-400">{p.supplierId.code}</div></td><td className="tabular px-5 py-4">{litres(p.litresMilli)}</td><td className="tabular px-5 py-4">{kg(p.kgMilli)}</td><td className="tabular px-5 py-4 font-semibold">{money(p.totalCents)}</td><td className="px-5 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusStyle[p.paymentStatus]??''}`}>{p.paymentStatus.replaceAll('_',' ')}</span></td><td className="px-5 py-4 text-xs text-stone-500">{p.dispatchStatus}</td><td className="px-5 py-4"><div className="flex items-center gap-3"><Link className="text-emerald-800" title="Receipt" to={`/purchases/${p._id}/receipt`}><Printer size={17}/></Link><Link className="text-amber-800 hover:underline" to={`/purchases/${p._id}/correct`}>Correct</Link></div></td></tr>)}</tbody></table></div>
      {!query.isLoading&&!shown.length&&<div className="p-12 text-center text-sm text-stone-500">No matching purchases.</div>}
      <div className="border-t border-stone-200 px-5 py-3 text-xs text-stone-500">Showing {shown.length} of {query.data?.pagination.total??0} records (first 100 loaded)</div>
    </div>
  </div>;
}
