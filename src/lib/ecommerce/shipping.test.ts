import { describe, expect, it } from 'vitest';
import { normalizeCarrier, serializeShippingConfig } from './shipping';

describe('normalizeCarrier', () => {
  it('trims and accepts a non-empty string', () => {
    expect(normalizeCarrier('  delhivery  ')).toBe('delhivery');
  });
  it('rejects empty/whitespace/non-string', () => {
    expect(normalizeCarrier('')).toBeNull();
    expect(normalizeCarrier('   ')).toBeNull();
    expect(normalizeCarrier(1)).toBeNull();
  });
});

describe('serializeShippingConfig', () => {
  it('builds the webhook_url from the base URL and row id', () => {
    const row = {
      id: 'ship_1',
      carrier: 'delhivery',
      created_at: '2026-01-01T00:00:00Z',
    };
    expect(serializeShippingConfig(row, 'https://crm.example.com')).toEqual({
      id: 'ship_1',
      carrier: 'delhivery',
      webhook_url: 'https://crm.example.com/api/webhooks/shipping/ship_1',
      created_at: '2026-01-01T00:00:00Z',
    });
  });
});
