import { useQuery } from '@tanstack/react-query';
import { Navigate, Route, Routes } from 'react-router-dom';
import { api } from './lib/api';
import { AppShell } from './components/AppShell';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Pos } from './pages/Pos';
import { Purchases } from './pages/Purchases';
import { Receipt } from './pages/Receipt';
import { Dispatches } from './pages/Dispatches';
import { Rates } from './pages/Rates';
import { Suppliers } from './pages/Suppliers';
import { Placeholder } from './pages/Placeholder';
import { CashBank } from './pages/CashBank';
import { Payments } from './pages/Payments';
import { Advances } from './pages/Advances';
import { CompanySales } from './pages/CompanySales';
import { DispatchDetail } from './pages/DispatchDetail';
import { Expenses } from './pages/Expenses';

export type SessionUser = { id: string; name: string; role: string };
export default function App() {
  const session = useQuery({ queryKey: ['session'], queryFn: () => api<{ user: SessionUser }>('/auth/me'), retry: false });
  if (session.isLoading) return <div className="grid min-h-screen place-items-center text-sm text-stone-500">Opening collection centre…</div>;
  if (!session.data) return <Routes><Route path="*" element={<Login />} /></Routes>;
  return <AppShell user={session.data.user}><Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/pos" element={<Pos />} />
    <Route path="/purchases" element={<Purchases />} />
    <Route path="/purchases/:id/receipt" element={<Receipt />} />
    <Route path="/suppliers" element={<Suppliers />} />
    <Route path="/rates" element={<Rates />} />
    <Route path="/dispatches" element={<Dispatches />} />
    <Route path="/dispatches/:id" element={<DispatchDetail />} />
    <Route path="/payments" element={<Payments />} />
    <Route path="/advances" element={<Advances />} />
    <Route path="/cash-bank" element={<CashBank />} />
    <Route path="/sales" element={<CompanySales />} />
    <Route path="/expenses" element={<Expenses />} />
    <Route path="/:section" element={<Placeholder />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes></AppShell>;
}
