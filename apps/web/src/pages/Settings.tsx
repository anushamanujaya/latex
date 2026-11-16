import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Landmark, Plus, WalletCards } from 'lucide-react';
import { api, money } from '../lib/api';

type Account = {
  _id: string;
  code: string;
  name: string;
  type: 'CASH' | 'BANK';
  balanceCents: number;
  active: boolean;
};

type Session = { user: { role: string } };

export function Settings() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<'CASH' | 'BANK'>('CASH');
  const [openingBalance, setOpeningBalance] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  const session = useQuery({ queryKey: ['session'], queryFn: () => api<Session>('/auth/me') });
  const accounts = useQuery({
    queryKey: ['cash-accounts'],
    queryFn: () => api<{ data: Account[] }>('/cash-accounts'),
  });
  const canCreate = ['ADMIN', 'ACCOUNTANT'].includes(session.data?.user.role ?? '');

  const create = useMutation({
    mutationFn: () => api<{ data: Account }>('/cash-accounts', {
      method: 'POST',
      body: JSON.stringify({
        idempotencyKey: crypto.randomUUID(),
        code: code.trim().toUpperCase(),
        name: name.trim(),
        type,
        openingBalanceCents: Math.round(Number(openingBalance) * 100),
      }),
    }),
    onSuccess: async () => {
      setCode('');
      setName('');
      setOpeningBalance('');
      setError('');
      setMessage('Account created and its audited opening balance was posted.');
      await queryClient.invalidateQueries({ queryKey: ['cash-accounts'] });
    },
    onError: (cause) => {
      setMessage('');
      setError(cause instanceof Error ? cause.message : 'Could not create account');
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setMessage('');
    if (!code.trim() || !name.trim()) return setError('Enter an account code and name.');
    if (openingBalance === '' || !Number.isFinite(Number(openingBalance)) || Number(openingBalance) < 0) {
      return setError('Enter a valid opening balance.');
    }
    create.mutate();
  }

  return <div>
    <div className="mb-7">
      <p className="text-sm font-medium text-emerald-800">Financial configuration</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-2 text-sm text-stone-500">Create cash and bank accounts with a traceable opening balance.</p>
    </div>

    {message && <div className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{message}</div>}
    {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

    {canCreate ? <form className="card mb-6 p-5 sm:p-6" onSubmit={submit}>
      <div className="mb-5">
        <h2 className="font-semibold">Create cash or bank account</h2>
        <p className="mt-1 text-xs leading-5 text-stone-500">Use the verified physical cash or bank balance. The opening balance is posted to the audit ledger when the account is created.</p>
      </div>
      <div className="grid items-end gap-4 md:grid-cols-2 xl:grid-cols-5">
        <label><span className="label">Account type</span><select className="input" value={type} onChange={(event) => setType(event.target.value as 'CASH' | 'BANK')}><option value="CASH">Cash</option><option value="BANK">Bank</option></select></label>
        <label><span className="label">Account code</span><input className="input uppercase" required minLength={2} maxLength={30} value={code} onChange={(event) => setCode(event.target.value)} placeholder="CASH-02"/></label>
        <label><span className="label">Account name</span><input className="input" required minLength={2} maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="Main Cash Drawer"/></label>
        <label><span className="label">Opening balance (LKR)</span><input className="input tabular" required type="number" min="0" step="0.01" value={openingBalance} onChange={(event) => setOpeningBalance(event.target.value)} placeholder="0.00"/></label>
        <button className="btn-primary" disabled={create.isPending}><Plus size={17}/>{create.isPending ? 'Creating…' : 'Create account'}</button>
      </div>
    </form> : <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">Only an administrator or accountant can create financial accounts.</div>}

    <section className="card overflow-hidden">
      <div className="border-b border-stone-200 p-5">
        <h2 className="font-semibold">Cash and bank accounts</h2>
        <p className="mt-1 text-xs text-stone-500">Current balances are calculated from posted ledger movements.</p>
      </div>
      {accounts.isLoading ? <div className="p-5 text-sm text-stone-500">Loading accounts…</div> : accounts.data?.data.length ? <div className="overflow-auto"><table className="w-full min-w-[620px] text-left text-sm">
        <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500"><tr><th className="px-5 py-3">Account</th><th className="px-5 py-3">Type</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Balance</th></tr></thead>
        <tbody>{accounts.data.data.map((account) => <tr className="border-t border-stone-100" key={account._id}>
          <td className="px-5 py-4"><div className="flex items-center gap-3"><div className="rounded-xl bg-emerald-50 p-2 text-emerald-800">{account.type === 'BANK' ? <Landmark size={18}/> : <WalletCards size={18}/>}</div><div><div className="font-medium">{account.name}</div><div className="text-xs text-stone-500">{account.code}</div></div></div></td>
          <td className="px-5 py-4">{account.type}</td>
          <td className="px-5 py-4"><span className={`rounded-full px-2 py-1 text-xs ${account.active ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'}`}>{account.active ? 'ACTIVE' : 'INACTIVE'}</span></td>
          <td className="tabular px-5 py-4 text-right font-semibold">{money(account.balanceCents)}</td>
        </tr>)}</tbody>
      </table></div> : <div className="p-5 text-sm text-stone-500">No financial accounts have been created.</div>}
    </section>
  </div>;
}
