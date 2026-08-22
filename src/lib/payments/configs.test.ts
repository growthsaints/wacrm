import { describe, expect, it } from 'vitest';
import { serializePaymentGatewayConfig } from './configs';

describe('serializePaymentGatewayConfig', () => {
  it('projects public fields, never leaks the secret, and computes webhook_url from origin', () => {
    const out = serializePaymentGatewayConfig(
      {
        id: 'cfg-1',
        account_id: 'acct-1',
        gateway: 'razorpay',
        webhook_secret: 'encrypted-blob',
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
      },
      'https://your-crm.example.com'
    );

    expect(out).not.toHaveProperty('webhook_secret');
    expect(out).not.toHaveProperty('account_id');
    expect(out).toEqual({
      id: 'cfg-1',
      gateway: 'razorpay',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      webhook_url: 'https://your-crm.example.com/api/v1/payments/webhook/cfg-1',
    });
  });
});
