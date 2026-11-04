import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { api, kg, litres, money } from '../lib/api';

type Context = {
  purchase: { _id:string; billNumber:string; supplierId:{_id:string;name:string}; litresMilli:number; kgMilli:number; densityReading:number; rateCentsPerKg:number; adjustmentCents:number; cashPaidCents:number; totalCents:number; outstandingCents:number; dispatchStatus:string; reversedAt?:string };
  advanceApplications: {advanceId:string;amountCents:number}[];
  cashAccountId: string|null;
  hasAllocatedSupplierPayment:boolean;
  correction:{correctionNumber:string;correctionType:string}|null;
};

export function PurchaseCorrection() {
  const {id}=useParams();
  const qc=useQueryClient();
  const context=useQuery({queryKey:['purchase-correction-context',id],queryFn:()=>api<{data:Context}>(`/purchases/${id}/correction-context`)});
  const suppliers=useQuery({queryKey:['suppliers'],queryFn:()=>api<{data:{_id:string;name:string}[]}>('/suppliers')});
  const [supplierId,setSupplierId]=useState('');
  const [litresValue,setLitresValue]=useState('');
  const [reading,setReading]=useState('');
  const [rate,setRate]=useState('');
  const [cashValue,setCashValue]=useState('');
  const [reason,setReason]=useState('');
  const [message,setMessage]=useState('');
  useEffect(()=>{const p=context.data?.data.purchase;if(p){setSupplierId(p.supplierId._id);setLitresValue(String(p.litresMilli/1000));setReading(String(p.densityReading));setRate(String(p.rateCentsPerKg/100));setCashValue(String(p.cashPaidCents/100));}},[context.data?.data.purchase]);
  const save=useMutation({mutationFn:()=>{
    const c=context.data!.data;
    return api<{data:{_id:string;status:string}}>(`/purchases/${id}/correction-requests`,{method:'POST',body:JSON.stringify({
      requestIdempotencyKey:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),supplierId,litresMilli:Math.round(Number(litresValue)*1000),densityReading:Number(reading),rateCentsPerKg:Math.round(Number(rate)*100),adjustmentCents:c.purchase.adjustmentCents,cashPaidCents:Math.round(Number(cashValue)*100),cashAccountId:c.cashAccountId??undefined,advanceApplications:c.advanceApplications,reason,eventAt:new Date().toISOString(),
    })});
  },onSuccess:async()=>{setMessage('Correction requested. A different administrator or accountant must review it before execution.');await qc.invalidateQueries({queryKey:['approvals']});},onError:e=>setMessage(e instanceof Error?e.message:'Correction request failed')});
  const c=context.data?.data;const p=c?.purchase;
  if(context.isLoading)return <div className="text-sm text-stone-500">Loading purchase correction…</div>;
  if(context.isError||!c||!p)return <div className="text-sm text-red-700">Could not load purchase correction context.</div>;
  const blocked=Boolean(p.reversedAt||c.correction||(c.hasAllocatedSupplierPayment&&p.dispatchStatus!=='ASSIGNED'));
  return <div className="max-w-3xl"><Link className="text-sm text-emerald-800" to="/purchases">← Purchase history</Link><h1 className="mt-4 text-3xl font-semibold">Correct {p.billNumber}</h1><p className="mt-2 text-sm text-stone-500">The original record and audit history are retained. Undispatched purchases are voided and replaced; dispatched purchases receive a linked adjustment without moving their boundary.</p>
    {message&&<div className="mt-5 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{message}</div>}
    <div className="card mt-5 grid gap-3 p-5 text-sm sm:grid-cols-3"><div>Original volume<br/><b>{litres(p.litresMilli)}</b></div><div>Original weight<br/><b>{kg(p.kgMilli)}</b></div><div>Original cost<br/><b>{money(p.totalCents)}</b></div><div>Cash carried forward<br/><b>{money(p.cashPaidCents)}</b></div><div>Advance carried forward<br/><b>{money(c.advanceApplications.reduce((sum,a)=>sum+a.amountCents,0))}</b></div><div>Dispatch<br/><b>{p.dispatchStatus}</b></div></div>
    {c.hasAllocatedSupplierPayment&&p.dispatchStatus!=='ASSIGNED'&&<p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">Reverse allocated supplier payments before replacing this purchase.</p>}
    {p.cashPaidCents>0&&p.dispatchStatus!=='ASSIGNED'&&<p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">A changed cash amount posts only the difference to the original cash account. Confirm additional cash was actually paid or a supplier refund was actually received before executing the approved request. An open shift is required.</p>}
    {c.correction&&<p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Already corrected as {c.correction.correctionNumber}. Further changes require a new approved accounting workflow.</p>}
    <form className="card mt-5 grid gap-4 p-5 sm:grid-cols-2" onSubmit={e=>{e.preventDefault();if(!blocked&&window.confirm('Submit this correction for independent review?'))save.mutate();}}>
      <label><span className="label">Supplier</span><select className="input" value={supplierId} disabled={p.dispatchStatus==='ASSIGNED'||c.advanceApplications.length>0||blocked} onChange={e=>setSupplierId(e.target.value)}>{suppliers.data?.data.map(s=><option key={s._id} value={s._id}>{s.name}</option>)}</select></label>
      <label><span className="label">Corrected litres</span><input className="input" type="number" min="0.001" step="0.001" required value={litresValue} disabled={blocked} onChange={e=>setLitresValue(e.target.value)}/></label>
      <label><span className="label">Density reading (original table version)</span><input className="input" type="number" step="1" required value={reading} disabled={blocked} onChange={e=>setReading(e.target.value)}/></label>
      <label><span className="label">Rate per KG (LKR)</span><input className="input" type="number" min="0" step="0.01" required value={rate} disabled={blocked} onChange={e=>setRate(e.target.value)}/></label>
      <label><span className="label">Corrected cash paid (LKR)</span><input className="input" type="number" min="0" step="0.01" required value={cashValue} disabled={blocked||p.dispatchStatus==='ASSIGNED'} onChange={e=>setCashValue(e.target.value)}/></label>
      <label className="sm:col-span-2"><span className="label">Approval reason</span><textarea className="input" minLength={5} required value={reason} disabled={blocked} onChange={e=>setReason(e.target.value)} /></label>
      <button className="btn-primary sm:col-span-2" disabled={blocked||save.isPending||!supplierId}>Request correction approval</button>
    </form>
  </div>;
}
