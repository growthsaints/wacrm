import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/meta-api', () => ({
  sendTemplateMessage: vi.fn(),
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((v: string) => `decrypted:${v}`),
}));
vi.mock('@/lib/billing/wallet', () => ({
  ensureWalletBalance: vi.fn(),
  chargeWalletForSend: vi.fn(),
  WalletError: class WalletError extends Error {},
}));
vi.mock('@/lib/whatsapp/daily-quota', () => ({
  ensureDailyBroadcastQuota: vi.fn(),
  DailyQuotaError: class DailyQuotaError extends Error {},
}));
vi.mock('@/lib/whatsapp/quality-guard', () => ({
  ensureQualityRatingSafe: vi.fn(),
  QualityRatingError: class QualityRatingError extends Error {},
}));

import { createBroadcast, resumeBroadcastDelivery, BroadcastError } from './broadcast-core';
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api';

// These assertions all fire in the pure validation prologue, before
// any Supabase call — a bare stub is enough.
const db = {} as SupabaseClient;

describe('createBroadcast validation', () => {
  it('rejects a missing template_name', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: '',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('rejects an empty recipient list', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [],
      })
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it('rejects more than 1000 recipients', async () => {
    const recipients = Array.from({ length: 1001 }, () => ({
      to: '+14155550123',
    }));
    await expect(
      createBroadcast(db, 'acc', 'user', { templateName: 'promo', recipients })
    ).rejects.toMatchObject({ status: 400 });
  });
});

interface ResumeDbOpts {
  broadcast?: { status: string; template_name: string; template_language: string } | null;
  config?: { phone_number_id: string; access_token: string } | null;
  pendingRows?: Array<{ id: string; send_params: unknown; contact: { phone: string } | null }>;
}

function makeResumeDb(opts: ResumeDbOpts) {
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));

  const from = vi.fn((table: string) => {
    if (table === 'broadcasts') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: opts.broadcast ?? null,
                error: null,
              }),
            }),
          }),
        }),
        update,
      };
    }
    if (table === 'whatsapp_config') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: opts.config ?? null, error: null }),
          }),
        }),
      };
    }
    if (table === 'message_templates') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          }),
        }),
      };
    }
    if (table === 'broadcast_recipients') {
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: opts.pendingRows ?? [], error: null }),
          }),
        }),
        update,
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from, update, updateEq } as unknown as SupabaseClient & {
    update: typeof update;
    updateEq: typeof updateEq;
  };
}

describe('resumeBroadcastDelivery', () => {
  beforeEach(() => {
    vi.mocked(sendTemplateMessage).mockReset();
  });

  it('rejects when the broadcast is not found', async () => {
    const resumeDb = makeResumeDb({ broadcast: null });
    await expect(resumeBroadcastDelivery(resumeDb, 'acct-1', 'b-1')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
    });
  });

  it('rejects when the broadcast is not awaiting confirmation', async () => {
    const resumeDb = makeResumeDb({
      broadcast: { status: 'sent', template_name: 'promo', template_language: 'en_US' },
    });
    await expect(resumeBroadcastDelivery(resumeDb, 'acct-1', 'b-1')).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
    });
  });

  it('rejects when WhatsApp is not configured', async () => {
    const resumeDb = makeResumeDb({
      broadcast: { status: 'awaiting_confirmation', template_name: 'promo', template_language: 'en_US' },
      config: null,
    });
    await expect(resumeBroadcastDelivery(resumeDb, 'acct-1', 'b-1')).rejects.toMatchObject({
      code: 'whatsapp_not_configured',
    });
  });

  it('rejects when there are no pending recipients left', async () => {
    const resumeDb = makeResumeDb({
      broadcast: { status: 'awaiting_confirmation', template_name: 'promo', template_language: 'en_US' },
      config: { phone_number_id: 'pnid', access_token: 'enc' },
      pendingRows: [],
    });
    await expect(resumeBroadcastDelivery(resumeDb, 'acct-1', 'b-1')).rejects.toMatchObject({
      code: 'bad_request',
    });
  });

  it('sends to every pending recipient and marks the broadcast sent', async () => {
    const resumeDb = makeResumeDb({
      broadcast: { status: 'awaiting_confirmation', template_name: 'promo', template_language: 'en_US' },
      config: { phone_number_id: 'pnid', access_token: 'enc' },
      pendingRows: [
        { id: 'r-1', send_params: ['Jane'], contact: { phone: '+14155550123' } },
        { id: 'r-2', send_params: null, contact: { phone: '+14155550124' } },
      ],
    });
    vi.mocked(sendTemplateMessage).mockResolvedValue({ messageId: 'wamid-1' } as never);

    const result = await resumeBroadcastDelivery(resumeDb, 'acct-1', 'b-1');

    expect(sendTemplateMessage).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ sent: 2, failed: 0, status: 'sent' });
    expect(resumeDb.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'sent' })
    );
  });

  it('marks the broadcast failed when every remaining send fails', async () => {
    const resumeDb = makeResumeDb({
      broadcast: { status: 'awaiting_confirmation', template_name: 'promo', template_language: 'en_US' },
      config: { phone_number_id: 'pnid', access_token: 'enc' },
      pendingRows: [{ id: 'r-1', send_params: [], contact: { phone: '+14155550123' } }],
    });
    vi.mocked(sendTemplateMessage).mockRejectedValue(new Error('meta down'));

    const result = await resumeBroadcastDelivery(resumeDb, 'acct-1', 'b-1');

    expect(result).toEqual({ sent: 0, failed: 1, status: 'failed' });
  });
});
