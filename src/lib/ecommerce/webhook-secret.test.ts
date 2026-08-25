import { describe, expect, it } from 'vitest';
import { normalizeWebhookSecret } from './webhook-secret';

describe('normalizeWebhookSecret', () => {
  it('accepts a secret of at least 16 chars, trimmed', () => {
    expect(normalizeWebhookSecret('  0123456789abcdef  ')).toBe(
      '0123456789abcdef'
    );
  });
  it('rejects a short secret', () => {
    expect(normalizeWebhookSecret('short')).toBeNull();
  });
  it('rejects a non-string', () => {
    expect(normalizeWebhookSecret(12345678901234567)).toBeNull();
  });
});
