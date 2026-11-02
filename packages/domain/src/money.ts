export type MoneyCents = number & { readonly __brand: 'MoneyCents' };

export function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
}

export function cents(value: number): MoneyCents {
  assertSafeInteger(value, 'money cents');
  return value as MoneyCents;
}

export function parseMoneyToCents(input: string): MoneyCents {
  if (!/^-?\d+(\.\d{1,2})?$/.test(input.trim())) throw new Error('Money requires at most 2 decimals');
  const negative = input.trim().startsWith('-');
  const unsigned = input.trim().replace('-', '');
  const [whole = '0', fraction = ''] = unsigned.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cents(negative ? -result : result);
}

export function formatLkr(value: MoneyCents): string {
  return new Intl.NumberFormat('en-LK', { style: 'currency', currency: 'LKR' }).format(value / 100);
}
