const configuredBase = import.meta.env.VITE_API_URL as string | undefined;
if (import.meta.env.PROD && !configuredBase) throw new Error('VITE_API_URL is required for a production build');
const BASE = (configuredBase ?? '/api/v1').replace(/\/$/, '');

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${BASE}${path}`, { ...init, credentials: 'include', headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new ApiError(response.status, body?.error?.message ?? 'Request failed');
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}

export const money = (cents: number) => new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR', minimumFractionDigits: 2 }).format(cents / 100);
export const kg = (milli: number) => `${(milli / 1000).toFixed(3)} kg`;
export const litres = (milli: number) => `${(milli / 1000).toFixed(2)} L`;
