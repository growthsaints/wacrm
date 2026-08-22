import { describe, expect, it } from 'vitest';
import { serializeShippingConfig } from './configs';

describe('serializeShippingConfig', () => {
  it('projects public fields, never leaks the secret, and computes webhook_url from origin', () => {
    const out = serializeShippingConfig(
      {
        id: 'cfg-1',
        account_id: 'acct-1',
        carrier: 'delhivery',
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
      carrier: 'delhivery',
      is_active: true,
      created_at: '2026-01-01T00:00:00Z',
      webhook_url: 'https://your-crm.example.com/api/v1/shipping/webhook/cfg-1',
    });
  });
});
