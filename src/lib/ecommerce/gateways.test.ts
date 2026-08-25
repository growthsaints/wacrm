import { describe, expect, it } from 'vitest';
import { isPaymentGateway, serializePaymentGatewayConfig } from './gateways';

describe('isPaymentGateway', () => {
  it('accepts razorpay', () => {
    expect(isPaymentGateway('razorpay')).toBe(true);
  });
  it('rejects an unsupported gateway', () => {
    expect(isPaymentGateway('stripe')).toBe(false);
    expect(isPaymentGateway(null)).toBe(false);
  });
});

describe('serializePaymentGatewayConfig', () => {
  it('builds the webhook_url from the base URL and row id', () => {
    const row = {
      id: 'cfg_1',
      gateway: 'razorpay',
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(
      serializePaymentGatewayConfig(row, 'https://crm.example.com')
    ).toEqual({
      id: 'cfg_1',
      gateway: 'razorpay',
      webhook_url: 'https://crm.example.com/api/webhooks/razorpay/cfg_1',
      created_at: '2026-01-01T00:00:00Z',
    });
  });
});
