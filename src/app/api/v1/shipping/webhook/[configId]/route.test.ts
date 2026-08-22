import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';

const mockDb = { from: vi.fn() };

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: () => mockDb,
}));
vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: vi.fn((v: string) => v.replace('enc:', '')),
}));
vi.mock('@/lib/notifications/rules', () => ({
  findActiveNotificationRule: vi.fn(),
  resolveTemplateParams: vi.fn(),
}));
vi.mock('@/lib/whatsapp/send-template-by-phone', () => ({
  sendTemplateMessageByPhone: vi.fn(),
}));

import { POST } from './route';
import {
  findActiveNotificationRule,
  resolveTemplateParams,
} from '@/lib/notifications/rules';
import { sendTemplateMessageByPhone } from '@/lib/whatsapp/send-template-by-phone';
import { SendMessageError } from '@/lib/whatsapp/send-message';

const SECRET = 'plain-secret';
const CONFIG_ROW = {
  id: 'cfg-1',
  account_id: 'acct-1',
  webhook_secret: `enc:${SECRET}`,
  is_active: true,
};

function sign(rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const sig = createHmac('sha256', SECRET).update(`${timestamp}.${rawBody}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function req(rawBody: string, signature?: string) {
  const headers: Record<string, string> = {};
  if (signature) headers['x-wacrm-signature'] = signature;
  return new Request('https://x.test/api/v1/shipping/webhook/cfg-1', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

function mockConfigLookup(row: Record<string, unknown> | null) {
  mockDb.from.mockImplementation(() => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }),
  }));
}

describe('POST /api/v1/shipping/webhook/[configId]', () => {
  beforeEach(() => {
    mockDb.from.mockReset();
    vi.mocked(findActiveNotificationRule).mockReset();
    vi.mocked(resolveTemplateParams).mockReset().mockReturnValue([]);
    vi.mocked(sendTemplateMessageByPhone).mockReset();
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

  it('401s when the signature header is missing, with zero downstream side effects', async () => {
    mockConfigLookup(CONFIG_ROW);
    const res = await POST(req('{}'), { params: Promise.resolve({ configId: 'cfg-1' }) });
    expect(res.status).toBe(401);
    expect(findActiveNotificationRule).not.toHaveBeenCalled();
    expect(sendTemplateMessageByPhone).not.toHaveBeenCalled();
  });

  it('401s on an invalid signature', async () => {
    mockConfigLookup(CONFIG_ROW);
    const body = '{"event":"shipment.delivered","to":"+1"}';
    const res = await POST(req(body, sign('different body')), {
      params: Promise.resolve({ configId: 'cfg-1' }),
    });
    expect(res.status).toBe(401);
    expect(sendTemplateMessageByPhone).not.toHaveBeenCalled();
  });

  it('400s on a malformed body even with a valid signature', async () => {
    mockConfigLookup(CONFIG_ROW);
    const res = await POST(req('not json', sign('not json')), {
      params: Promise.resolve({ configId: 'cfg-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('400s when event or to is missing', async () => {
    mockConfigLookup(CONFIG_ROW);
    const body = JSON.stringify({ to: '+14155550123', data: {} });
    const res = await POST(req(body, sign(body)), {
      params: Promise.resolve({ configId: 'cfg-1' }),
    });
    expect(res.status).toBe(400);
  });

  it('skips (200) an event outside the shipment.* namespace', async () => {
    mockConfigLookup(CONFIG_ROW);
    const body = JSON.stringify({ event: 'order.shipped', to: '+14155550123', data: {} });
    const res = await POST(req(body, sign(body)), {
      params: Promise.resolve({ configId: 'cfg-1' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual({ skipped: true, reason: 'unrecognized_event' });
    expect(findActiveNotificationRule).not.toHaveBeenCalled();
  });

  it('skips (200) a shipment.* event with no configured rule', async () => {
    mockConfigLookup(CONFIG_ROW);
    vi.mocked(findActiveNotificationRule).mockResolvedValue(null);
    const body = JSON.stringify({ event: 'shipment.delivered', to: '+14155550123', data: {} });
    const res = await POST(req(body, sign(body)), {
      params: Promise.resolve({ configId: 'cfg-1' }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.reason).toBe('no_rule_configured');
  });

  it('resolves params and sends on a configured, active rule', async () => {
    mockConfigLookup(CONFIG_ROW);
    vi.mocked(findActiveNotificationRule).mockResolvedValue({
      id: 'rule-1',
      event: 'shipment.delivered',
      templateName: 'shipment_delivered',
      templateLanguage: 'en',
      paramMapping: ['shipment.tracking_number'],
    });
    vi.mocked(resolveTemplateParams).mockReturnValue(['TRK123']);
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

    const body = JSON.stringify({
      event: 'shipment.delivered',
      to: '+14155550123',
      data: { shipment: { tracking_number: 'TRK123' } },
      idempotency_key: 'evt-1',
    });
    const res = await POST(req(body, sign(body)), {
      params: Promise.resolve({ configId: 'cfg-1' }),
    });

    expect(sendTemplateMessageByPhone).toHaveBeenCalledWith(mockDb, 'acct-1', {
      to: '+14155550123',
      name: null,
      templateName: 'shipment_delivered',
      templateLanguage: 'en',
      templateParams: ['TRK123'],
      idempotencyKey: 'evt-1',
    });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.message_id).toBe('msg-1');
  });

  it('returns 409 when a concurrent delivery holds the idempotency key', async () => {
    mockConfigLookup(CONFIG_ROW);
    vi.mocked(findActiveNotificationRule).mockResolvedValue({
      id: 'rule-1',
      event: 'shipment.delivered',
      templateName: 'shipment_delivered',
      templateLanguage: 'en',
      paramMapping: [],
    });
    vi.mocked(sendTemplateMessageByPhone).mockResolvedValue({ status: 'in_progress' });

    const body = JSON.stringify({ event: 'shipment.delivered', to: '+14155550123', data: {} });
    const res = await POST(req(body, sign(body)), {
      params: Promise.resolve({ configId: 'cfg-1' }),
    });
    expect(res.status).toBe(409);
  });

  it('maps a SendMessageError to its own status/code', async () => {
    mockConfigLookup(CONFIG_ROW);
    vi.mocked(findActiveNotificationRule).mockResolvedValue({
      id: 'rule-1',
      event: 'shipment.delivered',
      templateName: 'shipment_delivered',
      templateLanguage: 'en',
      paramMapping: [],
    });
    vi.mocked(sendTemplateMessageByPhone).mockRejectedValue(
      new SendMessageError('whatsapp_not_configured', 'no config', 400)
    );

    const body = JSON.stringify({ event: 'shipment.delivered', to: '+14155550123', data: {} });
    const res = await POST(req(body, sign(body)), {
      params: Promise.resolve({ configId: 'cfg-1' }),
    });
    expect(res.status).toBe(400);
  });
});
