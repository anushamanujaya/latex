import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api, money } from '../lib/api';
import { requestReversal } from '../lib/reversal';

type Expense={_id:string;expenseNumber:string;description:string;category:string;allocationType:string;dispatchId?:{_id:string;dispatchNumber:string};amountCents:number;paymentStatus:'PAID'|'UNPAID';status:'POSTED'|'REVERSED'};
type Account={_id:string;code:string;name:string;type:'CASH'|'BANK'};

export function Expenses(){
  const qc=useQueryClient();
  const [category,setCategory]=useState('Operational');
  const [description,setDescription]=useState('');
  const [amount,setAmount]=useState('');
  const [accountId,setAccountId]=useState('');
  const [message,setMessage]=useState('');
  const list=useQuery({queryKey:['expenses'],queryFn:()=>api<{data:Expense[]}>('/expenses')});
  const accounts=useQuery({queryKey:['cash-accounts'],queryFn:()=>api<{data:Account[]}>('/cash-accounts')});
  const refresh=async()=>{await Promise.all([qc.invalidateQueries({queryKey:['expenses']}),qc.invalidateQueries({queryKey:['cash-accounts']}),qc.invalidateQueries({queryKey:['cash-transactions']})]);};
  const create=useMutation({mutationFn:()=>api('/expenses',{method:'POST',body:JSON.stringify({idempotencyKey:crypto.randomUUID(),category,description,amountCents:Math.round(Number(amount)*100),allocationType:'GENERAL',expenseAt:new Date().toISOString(),paymentStatus:'UNPAID'})}),onSuccess:async()=>{setDescription('');setAmount('');setMessage('General expense recorded.');await refresh();},onError:e=>setMessage(e instanceof Error?e.message:'Expense failed')});
  const pay=useMutation({mutationFn:({expenseId,selectedAccount}:{expenseId:string;selectedAccount:Account})=>api(`/expenses/${expenseId}/pay`,{method:'POST',body:JSON.stringify({idempotencyKey:crypto.randomUUID(),eventAt:new Date().toISOString(),paymentMethod:selectedAccount.type,accountId:selectedAccount._id})}),onSuccess:async()=>{setMessage('Expense payment posted to the cash/bank ledger.');await refresh();},onError:e=>setMessage(e instanceof Error?e.message:'Expense payment failed')});
  const reverse=useMutation({mutationFn:({expenseId,reason}:{expenseId:string;reason:string})=>requestReversal('EXPENSE',expenseId,reason),onSuccess:async()=>{setMessage('Expense reversal submitted for independent approval.');await refresh();},onError:e=>setMessage(e instanceof Error?e.message:'Expense reversal failed')});
  const selected=accounts.data?.data.find(a=>a._id===accountId);
  return <div><div className="mb-7"><p className="text-sm font-medium text-emerald-800">Operating costs</p><h1 className="mt-1 text-3xl font-semibold">Business expenses</h1><p className="mt-2 text-sm text-stone-500">General expenses remain separate from direct dispatch profitability.</p></div>
    {message&&<div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm">{message}</div>}
    <form className="card mb-5 grid gap-3 p-5 md:grid-cols-4" onSubmit={e=>{e.preventDefault();create.mutate();}}><select className="input" value={category} onChange={e=>setCategory(e.target.value)}><option>Operational</option><option>Labour</option><option>Maintenance</option><option>Equipment</option><option>Handling</option></select><input className="input" required placeholder="Description" value={description} onChange={e=>setDescription(e.target.value)}/><input className="input" required type="number" min="0.01" step="0.01" placeholder="Amount (LKR)" value={amount} onChange={e=>setAmount(e.target.value)}/><button className="btn-primary" disabled={create.isPending}>Record expense</button></form>
    <div className="card mb-5 p-5"><label><span className="label">Account for paying an unpaid expense</span><select className="input max-w-sm" value={accountId} onChange={e=>setAccountId(e.target.value)}><option value="">Select account</option>{accounts.data?.data.map(a=><option key={a._id} value={a._id}>{a.code} · {a.name} ({a.type})</option>)}</select></label><p className="mt-2 text-xs text-stone-500">Cash payments require your open cashier shift. Bank payments do not.</p></div>
    <section className="card overflow-auto"><table className="w-full min-w-[850px] text-sm"><thead className="bg-stone-50 text-xs text-stone-500"><tr><th className="px-4 py-3 text-left">Expense</th><th className="px-4 py-3 text-left">Category</th><th className="px-4 py-3 text-left">Allocation</th><th className="px-4 py-3 text-right">Amount</th><th className="px-4 py-3">Payment</th><th className="px-4 py-3">State</th><th className="px-4 py-3">Actions</th></tr></thead><tbody>{list.data?.data.map(x=><tr className="border-t" key={x._id}><td className="px-4 py-3"><div className="font-medium">{x.expenseNumber}</div><div>{x.description}</div></td><td className="px-4 py-3">{x.category}</td><td className="px-4 py-3">{x.dispatchId?<Link className="text-emerald-800" to={`/dispatches/${x.dispatchId._id}`}>{x.dispatchId.dispatchNumber}</Link>:'General'}</td><td className="px-4 py-3 text-right">{money(x.amountCents)}</td><td className="px-4 py-3 text-center">{x.paymentStatus}</td><td className="px-4 py-3 text-center">{x.status}</td><td className="px-4 py-3 text-center">{x.status==='POSTED'&&<div className="flex justify-center gap-3">{x.paymentStatus==='UNPAID'&&<button className="text-emerald-800 disabled:opacity-50" disabled={!selected||pay.isPending} onClick={()=>selected&&pay.mutate({expenseId:x._id,selectedAccount:selected})}>Pay</button>}<button className="text-red-700 disabled:opacity-50" disabled={reverse.isPending} onClick={()=>{const reason=window.prompt(`Reason to request reversal of ${x.expenseNumber}?`);if(reason&&reason.trim().length>=5)reverse.mutate({expenseId:x._id,reason:reason.trim()});}}>Request reversal</button></div>}</td></tr>)}</tbody></table></section>
  </div>;
}
