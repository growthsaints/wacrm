import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

vi.mock('./resolve-conversation', () => ({
  resolveConversationByPhone: vi.fn(),
}));
vi.mock('./send-message', () => ({
  sendMessageToConversation: vi.fn(),
}));
vi.mock('@/lib/api/v1/idempotency', () => ({
  reserveIdempotencyKey: vi.fn(),
  fillIdempotencyKey: vi.fn(),
  releaseIdempotencyKey: vi.fn(),
}));

import { sendTemplateMessageByPhone } from './send-template-by-phone';
import { resolveConversationByPhone } from './resolve-conversation';
import { sendMessageToConversation } from './send-message';
import {
  reserveIdempotencyKey,
  fillIdempotencyKey,
  releaseIdempotencyKey,
} from '@/lib/api/v1/idempotency';

const db = {} as SupabaseClient;

describe('sendTemplateMessageByPhone', () => {
  beforeEach(() => {
    vi.mocked(resolveConversationByPhone).mockReset();
    vi.mocked(sendMessageToConversation).mockReset();
    vi.mocked(reserveIdempotencyKey).mockReset();
    vi.mocked(fillIdempotencyKey).mockReset();
    vi.mocked(releaseIdempotencyKey).mockReset();
  });

  it('resolves the phone, sends the template, and fills in the reservation on success', async () => {
    vi.mocked(reserveIdempotencyKey).mockResolvedValue({ status: 'reserved' });
    vi.mocked(resolveConversationByPhone).mockResolvedValue({
      conversationId: 'conv-1',
      contactId: 'contact-1',
      contactCreated: true,
    });
    vi.mocked(sendMessageToConversation).mockResolvedValue({
      messageId: 'msg-1',
      whatsappMessageId: 'wamid-1',
    });

    const outcome = await sendTemplateMessageByPhone(db, 'acct-1', {
      to: '+14155550123',
      templateName: 'order_shipped',
      templateParams: ['ORD-1'],
      idempotencyKey: 'evt-1',
    });

    expect(outcome).toEqual({
      status: 'sent',
      result: {
        messageId: 'msg-1',
        whatsappMessageId: 'wamid-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        contactCreated: true,
      },
    });
    expect(sendMessageToConversation).toHaveBeenCalledWith(db, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'template',
      templateName: 'order_shipped',
      templateLanguage: null,
      templateParams: ['ORD-1'],
    });
    expect(fillIdempotencyKey).toHaveBeenCalledWith(
      db,
      'acct-1',
      'evt-1',
      outcome.status === 'sent' ? outcome.result : undefined,
      'msg-1'
    );
    expect(releaseIdempotencyKey).not.toHaveBeenCalled();
  });

  it('replays a cached response without touching resolve/send', async () => {
    const cached = { message_id: 'msg-old' };
    vi.mocked(reserveIdempotencyKey).mockResolvedValue({
      status: 'replay',
      responseBody: cached,
    });

    const outcome = await sendTemplateMessageByPhone(db, 'acct-1', {
      to: '+14155550123',
      templateName: 'order_shipped',
      idempotencyKey: 'evt-1',
    });

    expect(outcome).toEqual({ status: 'replayed', result: cached });
    expect(resolveConversationByPhone).not.toHaveBeenCalled();
    expect(sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('reports in_progress without sending when a concurrent delivery holds the key', async () => {
    vi.mocked(reserveIdempotencyKey).mockResolvedValue({ status: 'in_progress' });

    const outcome = await sendTemplateMessageByPhone(db, 'acct-1', {
      to: '+14155550123',
      templateName: 'order_shipped',
      idempotencyKey: 'evt-1',
    });

    expect(outcome).toEqual({ status: 'in_progress' });
    expect(sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('releases the reservation and rethrows if the send fails', async () => {
    vi.mocked(reserveIdempotencyKey).mockResolvedValue({ status: 'reserved' });
    vi.mocked(resolveConversationByPhone).mockResolvedValue({
      conversationId: 'conv-1',
      contactId: 'contact-1',
      contactCreated: false,
    });
    vi.mocked(sendMessageToConversation).mockRejectedValue(new Error('meta down'));

    await expect(
      sendTemplateMessageByPhone(db, 'acct-1', {
        to: '+14155550123',
        templateName: 'order_shipped',
        idempotencyKey: 'evt-1',
      })
    ).rejects.toThrow('meta down');

    expect(releaseIdempotencyKey).toHaveBeenCalledWith(db, 'acct-1', 'evt-1');
    expect(fillIdempotencyKey).not.toHaveBeenCalled();
  });

  it('works without an idempotencyKey (no reservation bookkeeping at all)', async () => {
    vi.mocked(reserveIdempotencyKey).mockResolvedValue({ status: 'skipped' });
    vi.mocked(resolveConversationByPhone).mockResolvedValue({
      conversationId: 'conv-1',
      contactId: 'contact-1',
      contactCreated: false,
    });
    vi.mocked(sendMessageToConversation).mockResolvedValue({
      messageId: 'msg-1',
      whatsappMessageId: 'wamid-1',
    });

    const outcome = await sendTemplateMessageByPhone(db, 'acct-1', {
      to: '+14155550123',
      templateName: 'order_shipped',
    });

    expect(outcome.status).toBe('sent');
    expect(fillIdempotencyKey).not.toHaveBeenCalled();
    expect(releaseIdempotencyKey).not.toHaveBeenCalled();
  });
});
