import { describe, expect, it } from 'vitest';
import { PAYMENT_GATEWAYS, isPaymentGateway } from './gateway';

describe('isPaymentGateway', () => {
  it('accepts every declared gateway', () => {
    for (const g of PAYMENT_GATEWAYS) expect(isPaymentGateway(g)).toBe(true);
  });

  it('rejects unknown strings and non-strings', () => {
    expect(isPaymentGateway('stripe')).toBe(false);
    expect(isPaymentGateway('')).toBe(false);
    expect(isPaymentGateway(null)).toBe(false);
    expect(isPaymentGateway(42)).toBe(false);
  });
});
