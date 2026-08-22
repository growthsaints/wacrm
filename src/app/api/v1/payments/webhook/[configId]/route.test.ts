import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDb = { from: vi.fn() };

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => mockDb,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((v: string) => `decrypted:${v}`),
}));
vi.mock('@/lib/notifications/rules', () => ({
  findActiveNotificationRule: vi.fn(),
  resolveTemplateParams: vi.fn(),
}));
vi.mock('@/lib/whatsapp/send-template-by-phone', () => ({
  sendTemplateMessageByPhone: vi.fn(),
}));
vi.mock('@/lib/payments/registry', () => ({
  getGatewayAdapter: vi.fn(),
}));

import { POST } from './route';
import { decrypt } from '@/lib/whatsapp/encryption';
import {
  findActiveNotificationRule,
  resolveTemplateParams,
} from '@/lib/notifications/rules';
import { sendTemplateMessageByPhone } from '@/lib/whatsapp/send-template-by-phone';
import { getGatewayAdapter } from '@/lib/payments/registry';
import { SendMessageError } from '@/lib/whatsapp/send-message';

function req(body: string, headers: Record<string, string> = {}) {
  return new Request('https://x.test/api/v1/payments/webhook/cfg-1', {
    method: 'POST',
    headers,
    body,
  });
}

function mockConfigLookup(row: Record<string, unknown> | null) {
  mockDb.from.mockImplementation((table: string) => {
    if (table === 'payment_gateway_configs') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) };
    }
    return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
  });
}

const CONFIG_ROW = {
  id: 'cfg-1',
  account_id: 'acct-1',
  gateway: 'razorpay',
  webhook_secret: 'enc-secret',
  is_active: true,
};

describe('POST /api/v1/payments/webhook/[configId]', () => {
  beforeEach(() => {
    mockDb.from.mockReset();
    vi.mocked(decrypt).mockClear();
    vi.mocked(findActiveNotificationRule).mockReset();
    vi.mocked(resolveTemplateParams).mockReset().mockReturnValue([]);
    vi.mocked(sendTemplateMessageByPhone).mockReset();
    vi.mocked(getGatewayAdapter).mockReset();
  });

  it('404s when the config does not exist', async () => {
    mockConfigLookup(null);
    const res = await POST(req('{}'), { params: Promise.resolve({ configId: 'cfg-1' }) });
    expect(res.status).toBe(404);
  });

  it('404s when the config is disabled', async () => {
    mockConfigLookup({ ...CONFIG_ROW, is_active: false });
    const res = await POST(req('{}'), { params: Promise.resolve({ configId: 'cfg-1' }) });
    expect(res.status).toBe(404);
  });

  it('401s on an invalid signature, with zero downstream side effects', async () => {
    mockConfigLookup(CONFIG_ROW);
    vi.mocked(getGatewayAdapter).mockReturnValue({
      verifySignature: vi.fn(() => false),
      parseEvent: vi.fn(),
    });

    const res = await POST(req('{}', { 'x-razorpay-signature': 'bad' }), {
      params: Promise.resolve({ configId: 'cfg-1' }),
    });
    expect(res.status).toBe(401);
    expect(findActiveNotificationRule).not.toHaveBeenCalled();
    expect(sendTemplateMessageByPhone).not.toHaveBeenCalled();
  });

  it('skips (200) an event the adapter maps to null', async () => {
    mockConfigLookup(CONFIG_ROW);
    vi.mocked(getGatewayAdapter).mockReturnValue({
      verifySignature: vi.fn(() => true),
      parseEvent: vi.fn(() => ({ event: null, phone: null, data: {}, eventId: null })),
    });

    const res = await POST(req('{}'), { params: Promise.resolve({ configId: 'cfg-1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ skipped: true, reason: 'unrecognized_event' });
  });

  it('skips (200) when the payload carries no phone', async () => {
    mockConfigLookup(CONFIG_ROW);
    vi.mocked(getGatewayAdapter).mockReturnValue({
      verifySignature: vi.fn(() => true),
      parseEvent: vi.fn(() => ({
        event: 'payment.captured' as const,
        phone: null,
        data: {},
        eventId: 'evt-1',
      })),
    });

    const res = await POST(req('{}'), { params: Promise.resolve({ configId: 'cfg-1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.reason).toBe('no_phone_in_payload');
  });

  it('skips (200) when no notification rule is configured', async () => {
    mockConfigLookup(CONFIG_ROW);
    vi.mocked(getGatewayAdapter).mockReturnValue({
      verifySignature: vi.fn(() => true),
      parseEvent: vi.fn(() => ({
        event: 'payment.captured' as const,
        phone: '+14155550123',
        data: {},
        eventId: 'evt-1',
      })),
    });
    vi.mocked(findActiveNotificationRule).mockResolvedValue(null);

    const res = await POST(req('{}'), { params: Promise.resolve({ configId: 'cfg-1' }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.reason).toBe('no_rule_configured');
    expect(sendTemplateMessageByPhone).not.toHaveBeenCalled();
  });

  it('sends the template using the decrypted secret and the event id as the idempotency key', async () => {
    mockConfigLookup(CONFIG_ROW);
    const verifySignature = vi.fn(() => true);
    vi.mocked(getGatewayAdapter).mockReturnValue({
      verifySignature,
      parseEvent: vi.fn(() => ({
        event: 'payment.captured' as const,
        phone: '+14155550123',
        data: { payment: { id: 'pay_1' } },
        eventId: 'pay_1',
      })),
    });
    vi.mocked(findActiveNotificationRule).mockResolvedValue({
      id: 'rule-1',
      event: 'payment.captured',
      templateName: 'payment_received',
      templateLanguage: 'en',
      paramMapping: ['payment.id'],
    });
    vi.mocked(resolveTemplateParams).mockReturnValue(['pay_1']);
    vi.mocked(sendTemplateMessageByPhone).mockResolvedValue({
      status: 'sent',
      result: {
        messageId: 'msg-1',
        whatsappMessageId: 'wamid-1',
        conversationId: 'conv-1',
        contactId: 'contact-1',
        contactCreated: false,
      },
    });

    const res = await POST(req('{"event":"payment.captured"}'), {
      params: Promise.resolve({ configId: 'cfg-1' }),
    });

    expect(decrypt).toHaveBeenCalledWith('enc-secret');
    expect(verifySignature).toHaveBeenCalledWith(
      '{"event":"payment.captured"}',
      expect.any(Headers),
      'decrypted:enc-secret'
    );
    expect(sendTemplateMessageByPhone).toHaveBeenCalledWith(mockDb, 'acct-1', {
      to: '+14155550123',
      templateName: 'payment_received',
      templateLanguage: 'en',
      templateParams: ['pay_1'],
      idempotencyKey: 'pay_1',
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ ok: true, message_id: 'msg-1' });
  });

  it('maps a SendMessageError to its own status/code', async () => {
    mockConfigLookup(CONFIG_ROW);
    vi.mocked(getGatewayAdapter).mockReturnValue({
      verifySignature: vi.fn(() => true),
      parseEvent: vi.fn(() => ({
        event: 'payment.captured' as const,
        phone: '+14155550123',
        data: {},
        eventId: 'evt-1',
      })),
    });
    vi.mocked(findActiveNotificationRule).mockResolvedValue({
      id: 'rule-1',
      event: 'payment.captured',
      templateName: 'payment_received',
      templateLanguage: 'en',
      paramMapping: [],
    });
    vi.mocked(sendTemplateMessageByPhone).mockRejectedValue(
      new SendMessageError('whatsapp_not_configured', 'no config', 400)
    );

    const res = await POST(req('{}'), { params: Promise.resolve({ configId: 'cfg-1' }) });
    expect(res.status).toBe(400);
  });
});
