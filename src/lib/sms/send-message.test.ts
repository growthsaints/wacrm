import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/sms/gateway-api", () => ({ sendSms: vi.fn() }));
vi.mock("@/lib/sms/encryption", () => ({ decrypt: vi.fn((v: string) => `dec:${v}`) }));

import { sendSmsToConversation, SmsSendError, validateSendSmsParams } from "./send-message";
import { sendSms } from "@/lib/sms/gateway-api";

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs, mirroring
// src/lib/whatsapp/send-message.test.ts's `noDb()` convention.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error("db should not be queried for invalid params");
    },
  } as unknown as SupabaseClient;
}

describe("validateSendSmsParams", () => {
  it("rejects any messageType other than 'text'", () => {
    expect(() =>
      validateSendSmsParams({ messageType: "template", contentText: "hi" }),
    ).toThrow(SmsSendError);
    try {
      validateSendSmsParams({ messageType: "image", contentText: "hi" });
    } catch (e) {
      expect(e).toBeInstanceOf(SmsSendError);
      expect((e as SmsSendError).status).toBe(400);
      expect((e as SmsSendError).code).toBe("unsupported_message_type");
    }
  });

  it("requires non-empty content_text", () => {
    expect(() => validateSendSmsParams({ messageType: "text" })).toThrow(SmsSendError);
    expect(() =>
      validateSendSmsParams({ messageType: "text", contentText: "   " }),
    ).toThrow(SmsSendError);
  });

  it("accepts a valid text message", () => {
    expect(() =>
      validateSendSmsParams({ messageType: "text", contentText: "hello" }),
    ).not.toThrow();
  });
});

interface MockDevice {
  id: string;
  label?: string;
  enabled: boolean;
  base_url: string;
  username: string;
  password: string;
  sentToday: number;
}

interface MockDbOpts {
  conversation?: { sms_config_id: string | null; contact: { phone: string } | null } | null;
  config?: { id: string; enabled: boolean; base_url: string; username: string; password: string } | null;
  sentToday?: number;
  // Extra devices on the account, used only by the reassignment tests —
  // listEnabledDevicesWithCapacity (called when allowDeviceReassignOnCap
  // is set and the pinned device is at cap) queries every enabled
  // device on the account, not just the one the conversation is pinned
  // to.
  otherDevices?: MockDevice[];
}

function makeDb(opts: MockDbOpts) {
  const insertedMessage = { id: "msg-1" };
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));

  const allDevices: MockDevice[] = [
    ...(opts.config ? [{ ...opts.config, sentToday: opts.sentToday ?? 0 }] : []),
    ...(opts.otherDevices ?? []),
  ];
  const devicesById = new Map(allDevices.map((d) => [d.id, d]));

  const from = vi.fn((table: string) => {
    if (table === "conversations") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: opts.conversation === undefined ? null : opts.conversation,
                  error: opts.conversation === undefined ? { message: "not found" } : null,
                }),
              }),
            }),
          }),
        }),
        update,
      };
    }
    if (table === "sms_config") {
      return {
        select: (fields: string) => {
          if (fields.includes("label")) {
            // listEnabledDevicesWithCapacity: .select('id, label').eq('account_id', X).eq('enabled', true)
            return {
              eq: () => ({
                eq: async () => ({
                  data: allDevices.filter((d) => d.enabled).map((d) => ({ id: d.id, label: d.label ?? "SMS Gateway" })),
                  error: null,
                }),
              }),
            };
          }
          // by-id lookup: .select('*').eq('id', X).eq('account_id', Y).single()
          let filterId: string | undefined;
          return {
            eq: (col: string, val: string) => {
              if (col === "id") filterId = val;
              return {
                eq: () => ({
                  single: async () => {
                    const dev = filterId ? devicesById.get(filterId) : undefined;
                    return { data: dev ?? null, error: dev ? null : { message: "not found" } };
                  },
                }),
              };
            },
          };
        },
      };
    }
    if (table === "messages") {
      return {
        select: (...args: unknown[]) => {
          if (args[1] && typeof args[1] === "object" && "count" in (args[1] as object)) {
            return {
              eq: () => ({
                eq: () => ({
                  eq: (_col: string, deviceId: string) => ({
                    gte: async () => ({ count: devicesById.get(deviceId)?.sentToday ?? 0, error: null }),
                  }),
                }),
              }),
            };
          }
          return { single: async () => ({ data: insertedMessage, error: null }) };
        },
        insert: () => ({ select: () => ({ single: async () => ({ data: insertedMessage, error: null }) }) }),
        update,
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from, update, updateEq } as unknown as SupabaseClient & { update: typeof update };
}

describe("sendSmsToConversation — multi-device resolution", () => {
  beforeEach(() => {
    vi.mocked(sendSms).mockReset();
  });

  it("rejects when the conversation has no assigned device", async () => {
    const db = makeDb({ conversation: { sms_config_id: null, contact: { phone: "+14155550123" } } });
    await expect(
      sendSmsToConversation(db, "acct-1", { conversationId: "cv-1", messageType: "text", contentText: "hi" }),
    ).rejects.toMatchObject({ code: "sms_not_configured", status: 400 });
  });

  it("rejects when the assigned device no longer exists", async () => {
    const db = makeDb({
      conversation: { sms_config_id: "dev-1", contact: { phone: "+14155550123" } },
      config: null,
    });
    await expect(
      sendSmsToConversation(db, "acct-1", { conversationId: "cv-1", messageType: "text", contentText: "hi" }),
    ).rejects.toMatchObject({ code: "sms_not_configured" });
  });

  it("rejects when the assigned device is disabled", async () => {
    const db = makeDb({
      conversation: { sms_config_id: "dev-1", contact: { phone: "+14155550123" } },
      config: { id: "dev-1", enabled: false, base_url: "https://x", username: "u", password: "enc" },
    });
    await expect(
      sendSmsToConversation(db, "acct-1", { conversationId: "cv-1", messageType: "text", contentText: "hi" }),
    ).rejects.toMatchObject({ code: "sms_disabled", status: 403 });
  });

  it("rejects when the assigned device has hit its daily cap", async () => {
    const db = makeDb({
      conversation: { sms_config_id: "dev-1", contact: { phone: "+14155550123" } },
      config: { id: "dev-1", enabled: true, base_url: "https://x", username: "u", password: "enc" },
      sentToday: 100,
    });
    await expect(
      sendSmsToConversation(db, "acct-1", { conversationId: "cv-1", messageType: "text", contentText: "hi" }),
    ).rejects.toMatchObject({ code: "sms_daily_cap_reached", status: 429 });
  });

  it("reassigns on retry when the conversation has no assigned device at all", async () => {
    const db = makeDb({
      conversation: { sms_config_id: null, contact: { phone: "+14155550123" } },
      otherDevices: [
        { id: "dev-2", enabled: true, base_url: "https://y", username: "u2", password: "enc2", sentToday: 5 },
      ],
    });
    vi.mocked(sendSms).mockResolvedValue({ id: "gw-2", state: "Pending" });

    const result = await sendSmsToConversation(db, "acct-1", {
      conversationId: "cv-1",
      messageType: "text",
      contentText: "hi",
      allowDeviceReassignOnCap: true,
    });

    expect(result).toEqual({ messageId: "msg-1", gatewayMessageId: "gw-2", smsConfigId: "dev-2" });
  });

  it("still rejects (no reassign) when there's no assigned device and it isn't a retry", async () => {
    const db = makeDb({
      conversation: { sms_config_id: null, contact: { phone: "+14155550123" } },
      otherDevices: [
        { id: "dev-2", enabled: true, base_url: "https://y", username: "u2", password: "enc2", sentToday: 5 },
      ],
    });
    await expect(
      sendSmsToConversation(db, "acct-1", { conversationId: "cv-1", messageType: "text", contentText: "hi" }),
    ).rejects.toMatchObject({ code: "sms_not_configured", status: 400 });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("reassigns on retry when the assigned device was deleted (dangling sms_config_id)", async () => {
    const db = makeDb({
      conversation: { sms_config_id: "dev-1-deleted", contact: { phone: "+14155550123" } },
      otherDevices: [
        { id: "dev-2", enabled: true, base_url: "https://y", username: "u2", password: "enc2", sentToday: 5 },
      ],
    });
    vi.mocked(sendSms).mockResolvedValue({ id: "gw-2", state: "Pending" });

    const result = await sendSmsToConversation(db, "acct-1", {
      conversationId: "cv-1",
      messageType: "text",
      contentText: "hi",
      allowDeviceReassignOnCap: true,
    });

    expect(result).toEqual({ messageId: "msg-1", gatewayMessageId: "gw-2", smsConfigId: "dev-2" });
  });

  it("does NOT reassign on cap by default, even with another device free", async () => {
    const db = makeDb({
      conversation: { sms_config_id: "dev-1", contact: { phone: "+14155550123" } },
      config: { id: "dev-1", enabled: true, base_url: "https://x", username: "u", password: "enc" },
      sentToday: 100,
      otherDevices: [
        { id: "dev-2", enabled: true, base_url: "https://y", username: "u2", password: "enc2", sentToday: 5 },
      ],
    });
    await expect(
      sendSmsToConversation(db, "acct-1", { conversationId: "cv-1", messageType: "text", contentText: "hi" }),
    ).rejects.toMatchObject({ code: "sms_daily_cap_reached", status: 429 });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("reassigns to another device with capacity on a retry (allowDeviceReassignOnCap)", async () => {
    const db = makeDb({
      conversation: { sms_config_id: "dev-1", contact: { phone: "+14155550123" } },
      config: { id: "dev-1", enabled: true, base_url: "https://x", username: "u", password: "enc" },
      sentToday: 100,
      otherDevices: [
        { id: "dev-2", enabled: true, base_url: "https://y", username: "u2", password: "enc2", sentToday: 5 },
      ],
    });
    vi.mocked(sendSms).mockResolvedValue({ id: "gw-2", state: "Pending" });

    const result = await sendSmsToConversation(db, "acct-1", {
      conversationId: "cv-1",
      messageType: "text",
      contentText: "hi",
      allowDeviceReassignOnCap: true,
    });

    expect(sendSms).toHaveBeenCalledWith(
      { baseUrl: "https://y", username: "u2", password: "dec:enc2" },
      expect.objectContaining({ phoneNumbers: ["+14155550123"], text: "hi" }),
    );
    expect(result).toEqual({ messageId: "msg-1", gatewayMessageId: "gw-2", smsConfigId: "dev-2" });
  });

  it("still fails on a retry if every device is at cap", async () => {
    const db = makeDb({
      conversation: { sms_config_id: "dev-1", contact: { phone: "+14155550123" } },
      config: { id: "dev-1", enabled: true, base_url: "https://x", username: "u", password: "enc" },
      sentToday: 100,
      otherDevices: [
        { id: "dev-2", enabled: true, base_url: "https://y", username: "u2", password: "enc2", sentToday: 100 },
      ],
    });
    await expect(
      sendSmsToConversation(db, "acct-1", {
        conversationId: "cv-1",
        messageType: "text",
        contentText: "hi",
        allowDeviceReassignOnCap: true,
      }),
    ).rejects.toMatchObject({ code: "sms_daily_cap_reached", status: 429 });
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("sends through the assigned device when under cap", async () => {
    const db = makeDb({
      conversation: { sms_config_id: "dev-1", contact: { phone: "+14155550123" } },
      config: { id: "dev-1", enabled: true, base_url: "https://gateway", username: "u", password: "enc" },
      sentToday: 5,
    });
    vi.mocked(sendSms).mockResolvedValue({ id: "gw-1", state: "Pending" });

    const result = await sendSmsToConversation(db, "acct-1", {
      conversationId: "cv-1",
      messageType: "text",
      contentText: "hi",
    });

    expect(sendSms).toHaveBeenCalledWith(
      { baseUrl: "https://gateway", username: "u", password: "dec:enc" },
      expect.objectContaining({ phoneNumbers: ["+14155550123"], text: "hi" }),
    );
    expect(result).toEqual({ messageId: "msg-1", gatewayMessageId: "gw-1", smsConfigId: "dev-1" });
  });
});

describe("sendSmsToConversation — param validation (pre-DB)", () => {
  it("requires conversation_id", async () => {
    await expect(
      sendSmsToConversation(noDb(), "acct-1", { conversationId: "", messageType: "text", contentText: "hi" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a non-text message_type before touching the DB", async () => {
    await expect(
      sendSmsToConversation(noDb(), "acct-1", {
        conversationId: "cv-1",
        messageType: "template",
        contentText: "hi",
      }),
    ).rejects.toMatchObject({ status: 400, code: "unsupported_message_type" });
  });

  it("requires content_text before touching the DB", async () => {
    await expect(
      sendSmsToConversation(noDb(), "acct-1", { conversationId: "cv-1", messageType: "text" }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
