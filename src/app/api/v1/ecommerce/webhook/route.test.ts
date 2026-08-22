import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: vi.fn(),
}));
vi.mock('@/lib/notifications/rules', () => ({
  findActiveNotificationRule: vi.fn(),
  resolveTemplateParams: vi.fn(),
}));
vi.mock('@/lib/whatsapp/send-template-by-phone', () => ({
  sendTemplateMessageByPhone: vi.fn(),
}));

import { POST } from './route';
import { requireApiKey } from '@/lib/auth/api-context';
import {
  findActiveNotificationRule,
  resolveTemplateParams,
} from '@/lib/notifications/rules';
import { sendTemplateMessageByPhone } from '@/lib/whatsapp/send-template-by-phone';
import { SendMessageError } from '@/lib/whatsapp/send-message';

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://x.test/api/v1/ecommerce/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

const ctx = {
  authType: 'api_key' as const,
  supabase: {} as never,
  accountId: 'acct-1',
  keyId: 'key-1',
  scopes: ['messages:send'],
  createdBy: null,
};

describe('POST /api/v1/ecommerce/webhook', () => {
  beforeEach(() => {
    vi.mocked(requireApiKey).mockReset().mockResolvedValue(ctx);
    vi.mocked(findActiveNotificationRule).mockReset();
    vi.mocked(resolveTemplateParams).mockReset().mockReturnValue([]);
    vi.mocked(sendTemplateMessageByPhone).mockReset();
  });

  it('400s when event or to is missing', async () => {
    let res = await POST(req({ to: '+14155550123', data: {} }));
    expect(res.status).toBe(400);

    res = await POST(req({ event: 'order.shipped', data: {} }));
    expect(res.status).toBe(400);
  });

  it('skips (200) an event wacrm does not recognize, without touching rules or sending', async () => {
    const res = await POST(
      req({ event: 'order.exploded', to: '+14155550123', data: {} })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ skipped: true, reason: 'unrecognized_event' });
    expect(findActiveNotificationRule).not.toHaveBeenCalled();
    expect(sendTemplateMessageByPhone).not.toHaveBeenCalled();
  });

  it('skips (200) a known event with no configured rule', async () => {
    vi.mocked(findActiveNotificationRule).mockResolvedValue(null);

    const res = await POST(
      req({ event: 'order.shipped', to: '+14155550123', data: {} })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ skipped: true, reason: 'no_rule_configured' });
    expect(sendTemplateMessageByPhone).not.toHaveBeenCalled();
  });

  it('resolves params from the rule and sends on a configured, active rule', async () => {
    vi.mocked(findActiveNotificationRule).mockResolvedValue({
      id: 'rule-1',
      event: 'order.shipped',
      templateName: 'order_shipped',
      templateLanguage: 'en',
      paramMapping: ['order.number'],
    });
    vi.mocked(resolveTemplateParams).mockReturnValue(['ORD-42']);
    vi.mocked(sendTemplateMessageByPhone).mockResolvedValue({
      status: 'sent',
      result: {
        messageId: 'msg-1',
        whatsappMessageId: 'wamid-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        contactCreated: true,
      },
    });

    const res = await POST(
      req(
        {
          event: 'order.shipped',
          to: '+14155550123',
          data: { order: { number: 'ORD-42' } },
        },
        { 'Idempotency-Key': 'evt-1' }
      )
    );

    expect(sendTemplateMessageByPhone).toHaveBeenCalledWith(
      ctx.supabase,
      'acct-1',
      {
        to: '+14155550123',
        name: null,
        templateName: 'order_shipped',
        templateLanguage: 'en',
        templateParams: ['ORD-42'],
        idempotencyKey: 'evt-1',
      }
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data).toEqual({
      message_id: 'msg-1',
      whatsapp_message_id: 'wamid-1',
      conversation_id: 'conv-1',
      contact_id: 'contact-1',
      contact_created: true,
    });
  });

  it('returns 409 when a concurrent delivery holds the idempotency key', async () => {
    vi.mocked(findActiveNotificationRule).mockResolvedValue({
      id: 'rule-1',
      event: 'order.shipped',
      templateName: 'order_shipped',
      templateLanguage: 'en',
      paramMapping: [],
    });
    vi.mocked(sendTemplateMessageByPhone).mockResolvedValue({ status: 'in_progress' });

    const res = await POST(
      req({ event: 'order.shipped', to: '+14155550123', data: {} })
    );
    expect(res.status).toBe(409);
  });

  it('maps a SendMessageError to its own status/code', async () => {
    vi.mocked(findActiveNotificationRule).mockResolvedValue({
      id: 'rule-1',
      event: 'order.shipped',
      templateName: 'order_shipped',
      templateLanguage: 'en',
      paramMapping: [],
    });
    vi.mocked(sendTemplateMessageByPhone).mockRejectedValue(
      new SendMessageError('whatsapp_not_configured', 'no config', 400)
    );

    const res = await POST(
      req({ event: 'order.shipped', to: '+14155550123', data: {} })
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe('whatsapp_not_configured');
  });
});
