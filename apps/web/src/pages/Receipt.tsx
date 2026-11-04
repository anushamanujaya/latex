import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { api, kg, litres, money } from '../lib/api';

type Purchase = {
  billNumber: string; eventAt: string; sequence: number;
  supplierId: { code: string; name: string };
  litresMilli: number; densityReading: number; factorMilli: number; kgMilli: number;
  rateCentsPerKg: number; subtotalCents: number; adjustmentCents: number; totalCents: number;
  advanceAppliedCents: number; cashPaidCents: number; outstandingCents: number; paymentStatus: string;
};

export function Receipt() {
  const { id } = useParams();
  const query = useQuery({ queryKey: ['purchase', id], queryFn: () => api<{ data: Purchase }>(`/purchases/${id}`), enabled: Boolean(id) });
  const p = query.data?.data;
  if (!p) return <div className="text-sm text-stone-500">Loading receipt…</div>;

  return <div>
    <div className="no-print mb-6 flex items-center justify-between">
      <Link to="/purchases" className="btn-secondary"><ArrowLeft size={17}/> Purchase history</Link>
      <button className="btn-primary" onClick={() => window.print()}><Printer size={17}/> Print 80 mm receipt</button>
    </div>
    <div className="mx-auto w-full max-w-sm bg-white p-7 font-mono text-[12px] leading-5 shadow-xl" id="receipt">
      <div className="text-center"><div className="text-base font-bold">ARALIYA LATEX COLLECTION CENTRE</div><div>Purchase Receipt</div><div className="mt-1 text-[10px]">Main Collection Centre · Sri Lanka</div></div>
      <div className="my-3 border-t border-dashed border-black"/>
      <div className="flex justify-between"><span>Bill No:</span><b>{p.billNumber}</b></div>
      <div className="flex justify-between"><span>Sequence:</span><span>{p.sequence}</span></div>
      <div className="flex justify-between"><span>Date:</span><span>{new Date(p.eventAt).toLocaleDateString('en-LK')}</span></div>
      <div className="flex justify-between"><span>Time:</span><span>{new Date(p.eventAt).toLocaleTimeString('en-LK', { hour: '2-digit', minute: '2-digit' })}</span></div>
      <div className="my-3 border-t border-dashed border-black"/>
      <div><b>Supplier:</b> {p.supplierId.name}</div><div><b>Supplier ID:</b> {p.supplierId.code}</div>
      <div className="my-3 border-t border-dashed border-black"/>
      <div className="flex justify-between"><span>Quantity:</span><span>{litres(p.litresMilli)}</span></div>
      <div className="flex justify-between"><span>Density reading:</span><span>{p.densityReading}</span></div>
      <div className="flex justify-between"><span>Factor:</span><span>{(p.factorMilli / 1000).toFixed(2)}</span></div>
      <div className="flex justify-between"><span>Calculated KG:</span><span>{kg(p.kgMilli)}</span></div>
      <div className="flex justify-between"><span>Rate / KG:</span><span>{money(p.rateCentsPerKg)}</span></div>
      <div className="my-3 border-t border-dashed border-black"/>
      <div className="flex justify-between"><span>Latex subtotal:</span><span>{money(p.subtotalCents)}</span></div>
      <div className="flex justify-between"><span>Price adjustment:</span><span>{money(p.adjustmentCents)}</span></div>
      <div className="flex justify-between text-sm font-bold"><span>TOTAL:</span><span>{money(p.totalCents)}</span></div>
      <div className="flex justify-between"><span>Advance Applied:</span><span>{money(p.advanceAppliedCents)}</span></div>
      <div className="flex justify-between"><span>Cash Paid:</span><span>{money(p.cashPaidCents)}</span></div>
      <div className="flex justify-between font-bold"><span>BALANCE DUE:</span><span>{money(p.outstandingCents)}</span></div>
      <div className="mt-2">Status: <b>{p.paymentStatus.replace('_', ' ')}</b></div>
      <div className="my-3 border-t border-dashed border-black"/>
      <div className="text-center">Thank You!<br/><span className="text-[9px]">Reprints do not create a new purchase.</span></div>
    </div>
  </div>;
}
