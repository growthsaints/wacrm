import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { logNotificationSend } from './logs';

describe('logNotificationSend', () => {
  it('inserts a row with the given fields, defaulting optionals to null', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient;

    await logNotificationSend(db, {
      accountId: 'acct-1',
      source: 'ecommerce',
      event: 'order.shipped',
      status: 'sent',
      phone: '+14155550123',
      templateName: 'order_shipped',
    });

    expect(db.from).toHaveBeenCalledWith('notification_send_logs');
    expect(insert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      source: 'ecommerce',
      event: 'order.shipped',
      phone: '+14155550123',
      template_name: 'order_shipped',
      status: 'sent',
      reason: null,
    });
  });

  it('defaults phone/template_name/reason to null when omitted', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient;

    await logNotificationSend(db, {
      accountId: 'acct-1',
      source: 'payment',
      event: 'payment.captured',
      status: 'skipped',
    });

    expect(insert).toHaveBeenCalledWith({
      account_id: 'acct-1',
      source: 'payment',
      event: 'payment.captured',
      phone: null,
      template_name: null,
      status: 'skipped',
      reason: null,
    });
  });

  it('swallows a DB error rather than throwing', async () => {
    const insert = vi.fn(async () => ({ error: { message: 'boom' } }));
    const db = { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient;

    await expect(
      logNotificationSend(db, {
        accountId: 'acct-1',
        source: 'shipping',
        event: 'shipment.delivered',
        status: 'failed',
        reason: 'Meta rejected the send',
      })
    ).resolves.toBeUndefined();
  });

  it('swallows a thrown error (e.g. a mock with no .from) rather than throwing', async () => {
    const db = {} as unknown as SupabaseClient;
    await expect(
      logNotificationSend(db, {
        accountId: 'acct-1',
        source: 'ecommerce',
        event: 'order.shipped',
        status: 'sent',
      })
    ).resolves.toBeUndefined();
  });
});
