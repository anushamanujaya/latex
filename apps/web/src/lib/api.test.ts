import { describe, expect, it } from 'vitest';
import { kg, litres, money } from './api';

describe('operator formatting', () => {
  it('renders stored scaled units without changing values', () => {
    expect(kg(4_000)).toBe('4.000 kg');
    expect(litres(10_000)).toBe('10.00 L');
    expect(money(328_000)).toContain('3,280.00');
  });
});
