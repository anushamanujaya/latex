import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { Activity, Banknote, BarChart3, Building2, ChevronLeft, ClipboardList, Gauge, HandCoins, LayoutDashboard, LogOut, Menu, PackageOpen, ReceiptText, Settings, ShieldCheck, Truck, Users, WalletCards, X } from 'lucide-react';
import { api } from '../lib/api';
import type { SessionUser } from '../App';

const links = [
  ['Dashboard', '/', LayoutDashboard], ['Latex POS', '/pos', Gauge], ['Purchase History', '/purchases', ReceiptText], ['Suppliers', '/suppliers', Users],
  ['Supplier Ledger', '/supplier-ledger', ClipboardList], ['Advances & Loans', '/advances', HandCoins], ['Payments', '/payments', WalletCards], ['Daily Rates', '/rates', Activity],
  ['Inventory', '/inventory', PackageOpen], ['Bowser Dispatches', '/dispatches', Truck], ['Company Sales', '/sales', Banknote], ['Buyers / Companies', '/buyers', Building2],
  ['Expenses', '/expenses', ReceiptText], ['Cash & Bank', '/cash-bank', WalletCards], ['Reports & Analytics', '/reports', BarChart3], ['Audit Log', '/audit', ShieldCheck], ['Settings', '/settings', Settings],
] as const;

export function AppShell({ user, children }: { user: SessionUser; children: ReactNode }) {
  const [open, setOpen] = useState(false); const navigate = useNavigate();
  async function logout() { await api('/auth/logout', { method: 'POST' }); navigate(0); }
  return <div className="min-h-screen bg-[#f4f6f3]">
    {open && <button className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setOpen(false)} aria-label="Close navigation" />}
    <aside className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-[#132d25] text-white transition-transform lg:translate-x-0 ${open ? 'translate-x-0' : '-translate-x-full'}`}>
      <div className="flex h-20 items-center gap-3 border-b border-white/10 px-5"><div className="grid size-10 place-items-center rounded-xl bg-[#d4a94f] font-black text-[#132d25]">AL</div><div><div className="font-semibold tracking-wide">Araliya Latex</div><div className="text-xs text-emerald-100/60">Collection Operations</div></div><button className="ml-auto lg:hidden" onClick={() => setOpen(false)}><X size={20}/></button></div>
      <nav className="flex-1 overflow-y-auto p-3">{links.map(([label, to, Icon]) => <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)} className={({ isActive }) => `mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${isActive ? 'bg-white text-[#16382c] shadow' : 'text-emerald-50/75 hover:bg-white/8 hover:text-white'}`}><Icon size={18}/>{label}</NavLink>)}</nav>
      <div className="border-t border-white/10 p-4"><div className="mb-3 flex items-center gap-3"><div className="grid size-9 place-items-center rounded-full bg-emerald-700 text-sm font-bold">{user.name[0]}</div><div className="min-w-0"><div className="truncate text-sm font-medium">{user.name}</div><div className="text-xs text-emerald-100/50">{user.role}</div></div></div><button onClick={logout} className="flex w-full items-center gap-2 text-xs text-emerald-100/60 hover:text-white"><LogOut size={15}/> Sign out</button></div>
    </aside>
    <div className="lg:pl-72"><header className="sticky top-0 z-20 flex h-16 items-center border-b border-stone-200 bg-white/90 px-4 backdrop-blur lg:px-8"><button className="mr-3 lg:hidden" onClick={() => setOpen(true)}><Menu/></button><div className="text-sm text-stone-500">Main Collection Centre · <span className="font-medium text-emerald-800">Open</span></div><div className="ml-auto hidden text-sm text-stone-500 sm:block">Asia/Colombo</div></header><main className="p-4 sm:p-6 lg:p-8">{children}</main></div>
  </div>;
}
