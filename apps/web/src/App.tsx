import { lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './lib/api';
import { AppShell } from './components/AppShell';
const Login = lazy(() => import('./pages/Login').then(m => ({ default: m.Login })));
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const Pos = lazy(() => import('./pages/Pos').then(m => ({ default: m.Pos })));
const Purchases = lazy(() => import('./pages/Purchases').then(m => ({ default: m.Purchases })));
const Receipt = lazy(() => import('./pages/Receipt').then(m => ({ default: m.Receipt })));
const Dispatches = lazy(() => import('./pages/Dispatches').then(m => ({ default: m.Dispatches })));
const Rates = lazy(() => import('./pages/Rates').then(m => ({ default: m.Rates })));
const Suppliers = lazy(() => import('./pages/Suppliers').then(m => ({ default: m.Suppliers })));
const Placeholder = lazy(() => import('./pages/Placeholder').then(m => ({ default: m.Placeholder })));
const CashBank = lazy(() => import('./pages/CashBank').then(m => ({ default: m.CashBank })));
const Payments = lazy(() => import('./pages/Payments').then(m => ({ default: m.Payments })));
const Advances = lazy(() => import('./pages/Advances').then(m => ({ default: m.Advances })));
const CompanySales = lazy(() => import('./pages/CompanySales').then(m => ({ default: m.CompanySales })));
const DispatchDetail = lazy(() => import('./pages/DispatchDetail').then(m => ({ default: m.DispatchDetail })));
const Expenses = lazy(() => import('./pages/Expenses').then(m => ({ default: m.Expenses })));
const PurchaseCorrection = lazy(() => import('./pages/PurchaseCorrection').then(m => ({ default: m.PurchaseCorrection })));
const Approvals = lazy(() => import('./pages/Approvals').then(m => ({ default: m.Approvals })));
const FinancialAudit = lazy(() => import('./pages/FinancialAudit').then(m => ({ default: m.FinancialAudit })));

export type SessionUser = { id: string; name: string; role: string };
export default function App() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<{ user: SessionUser }>('/auth/me'), retry: false });
  if (session.isLoading) return <div className="grid min-h-screen place-items-center text-sm text-stone-500">Opening collection centre…</div>;
  if (!session.data) return <Suspense fallback={<div>Loading…</div>}><Routes><Route path="*" element={<Login />} /></Routes></Suspense>;
  return <AppShell user={session.data.user}><Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading page…</div>}><Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/pos" element={<Pos />} />
    <Route path="/purchases" element={<Purchases />} />
    <Route path="/purchases/:id/receipt" element={<Receipt />} />
    <Route path="/purchases/:id/correct" element={<PurchaseCorrection />} />
    <Route path="/suppliers" element={<Suppliers />} />
    <Route path="/rates" element={<Rates />} />
    <Route path="/dispatches" element={<Dispatches />} />
    <Route path="/dispatches/:id" element={<DispatchDetail />} />
    <Route path="/payments" element={<Payments />} />
    <Route path="/advances" element={<Advances />} />
    <Route path="/cash-bank" element={<CashBank />} />
    <Route path="/sales" element={<CompanySales />} />
    <Route path="/expenses" element={<Expenses />} />
    <Route path="/approvals" element={<Approvals />} />
    <Route path="/approvals/:id" element={<Approvals />} />
    <Route path="/audit" element={<FinancialAudit />} />
    <Route path="/:section" element={<Placeholder />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></Suspense></AppShell>;
}
