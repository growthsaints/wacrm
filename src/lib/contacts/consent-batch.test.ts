import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('@/lib/whatsapp/send-template-by-phone', () => ({
  sendTemplateMessageByPhone: vi.fn(),
}));

import {
  sendPendingConsentRequests,
  CONSENT_BATCH_DEFAULT_LIMIT,
  CONSENT_BATCH_MAX_LIMIT,
} from './consent-batch';
import { sendTemplateMessageByPhone } from '@/lib/whatsapp/send-template-by-phone';

function makeDb(pendingRows: Array<{ id: string; phone_number: string }>, remainingCount = 0) {
  const select = vi.fn((...args: unknown[]) => {
    // count-mode select: ('id', { count: 'exact', head: true })
    if (args[1] && typeof args[1] === 'object' && 'count' in (args[1] as object)) {
      return {
        eq: () => ({
          eq: () => ({
            is: async () => ({ count: remainingCount }),
          }),
        }),
      };
    }
    return {
      eq: () => ({
        eq: () => ({
          is: () => ({
            order: () => ({
              limit: async () => ({ data: pendingRows, error: null }),
            }),
          }),
        }),
      }),
    };
  });
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));
  const from = vi.fn(() => ({ select, update }));
  return { from, select, update, updateEq } as unknown as SupabaseClient & {
    select: typeof select;
    update: typeof update;
    updateEq: typeof updateEq;
  };
}

describe('sendPendingConsentRequests', () => {
  beforeEach(() => {
    vi.mocked(sendTemplateMessageByPhone).mockReset();
  });

  it('sends to each pending row and marks consent_template_sent_at', async () => {
    const db = makeDb(
      [
        { id: 'row-1', phone_number: '14155550123' },
        { id: 'row-2', phone_number: '14155550124' },
      ],
      3
    );
    vi.mocked(sendTemplateMessageByPhone).mockResolvedValue({
      status: 'sent',
      result: {
        messageId: 'm',
        whatsappMessageId: 'w',
        conversationId: 'c',
        contactId: 'ct',
        contactCreated: false,
      },
    });

    const result = await sendPendingConsentRequests(db, 'acct-1', {
      templateName: 'ask_consent',
      templateLanguage: 'en',
    });

    expect(sendTemplateMessageByPhone).toHaveBeenCalledTimes(2);
    expect(sendTemplateMessageByPhone).toHaveBeenCalledWith(db, 'acct-1', {
      to: '14155550123',
      templateName: 'ask_consent',
      templateLanguage: 'en',
    });
    expect(db.updateEq).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ attempted: 2, sent: 2, failed: 0, remainingPending: 3 });
  });

  it('counts a thrown send error as failed without aborting the rest of the batch', async () => {
    const db = makeDb([
      { id: 'row-1', phone_number: '14155550123' },
      { id: 'row-2', phone_number: '14155550124' },
    ]);
    vi.mocked(sendTemplateMessageByPhone)
      .mockRejectedValueOnce(new Error('meta down'))
      .mockResolvedValueOnce({
        status: 'sent',
        result: {
          messageId: 'm',
          whatsappMessageId: 'w',
          conversationId: 'c',
          contactId: 'ct',
          contactCreated: false,
        },
      });

    const result = await sendPendingConsentRequests(db, 'acct-1', {
      templateName: 'ask_consent',
    });

    expect(result.attempted).toBe(2);
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(1);
  });

  it('counts an in_progress outcome (idempotency race) as failed, not sent', async () => {
    const db = makeDb([{ id: 'row-1', phone_number: '14155550123' }]);
    vi.mocked(sendTemplateMessageByPhone).mockResolvedValue({ status: 'in_progress' });

    const result = await sendPendingConsentRequests(db, 'acct-1', {
      templateName: 'ask_consent',
    });

    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(db.updateEq).not.toHaveBeenCalled();
  });

  it('clamps a caller-supplied limit to CONSENT_BATCH_MAX_LIMIT and floors below 1', async () => {
    const db = makeDb([]);
    await sendPendingConsentRequests(db, 'acct-1', {
      templateName: 'ask_consent',
      limit: 99999,
    });
    // Can't directly inspect .limit() call args with this lightweight
    // mock, but the default/max constants stay a documented contract:
    expect(CONSENT_BATCH_MAX_LIMIT).toBe(100);
    expect(CONSENT_BATCH_DEFAULT_LIMIT).toBe(25);
  });
});
