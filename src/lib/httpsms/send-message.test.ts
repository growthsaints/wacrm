import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/httpsms/client", () => ({ sendHttpSms: vi.fn() }));
vi.mock("@/lib/httpsms/encryption", () => ({ decrypt: vi.fn((v: string) => `dec:${v}`) }));

import { sendHttpSmsToConversation, HttpSmsSendError, validateSendHttpSmsParams } from "./send-message";
import { sendHttpSms } from "@/lib/httpsms/client";

function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error("db should not be queried for invalid params");
    },
  } as unknown as SupabaseClient;
}

describe("validateSendHttpSmsParams", () => {
  it("rejects any messageType other than 'text'", () => {
    expect(() => validateSendHttpSmsParams({ messageType: "template", contentText: "hi" })).toThrow(
      HttpSmsSendError,
    );
  });

  it("requires non-empty content_text", () => {
    expect(() => validateSendHttpSmsParams({ messageType: "text" })).toThrow(HttpSmsSendError);
  });

  it("accepts a valid text message", () => {
    expect(() => validateSendHttpSmsParams({ messageType: "text", contentText: "hello" })).not.toThrow();
  });
});

interface MockNumber {
  id: string;
  label: string;
  phone_number: string;
  api_key: string;
  enabled: boolean;
  conversationCount: number;
}

interface MockDbOpts {
  conversation?: { httpsms_config_id: string | null; contact: { phone: string } | null } | null;
  config?: MockNumber | null;
  otherNumbers?: MockNumber[];
}

function makeDb(opts: MockDbOpts) {
  const insertedMessage = { id: "msg-1" };
  const updateEq = vi.fn(async () => ({ error: null }));
  const update = vi.fn(() => ({ eq: updateEq }));

  const allNumbers: MockNumber[] = [
    ...(opts.config ? [opts.config] : []),
    ...(opts.otherNumbers ?? []),
  ];
  const numbersById = new Map(allNumbers.map((n) => [n.id, n]));

  const from = vi.fn((table: string) => {
    if (table === "conversations") {
      return {
        select: (fields: string) => {
          if (fields === "id") {
            // listEnabledHttpSmsNumbers: .select('id', {count:'exact',head:true}).eq('httpsms_config_id', c.id)
            return {
              eq: (_col: string, configId: string) =>
                Promise.resolve({ count: numbersById.get(configId)?.conversationCount ?? 0, error: null }),
            };
          }
          return {
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
          };
        },
        update,
      };
    }
    if (table === "httpsms_config") {
      return {
        select: (fields: string) => {
          if (fields.includes("label")) {
            // listEnabledHttpSmsNumbers: .select('id, label, phone_number').eq('account_id',X).eq('enabled',true)
            return {
              eq: () => ({
                eq: async () => ({
                  data: allNumbers.filter((n) => n.enabled).map((n) => ({ id: n.id, label: n.label, phone_number: n.phone_number })),
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
                    const n = filterId ? numbersById.get(filterId) : undefined;
                    return { data: n ?? null, error: n ? null : { message: "not found" } };
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
        insert: () => ({ select: () => ({ single: async () => ({ data: insertedMessage, error: null }) }) }),
        update,
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from, update, updateEq } as unknown as SupabaseClient & { update: typeof update };
}

describe("sendHttpSmsToConversation — number resolution", () => {
  beforeEach(() => {
    vi.mocked(sendHttpSms).mockReset();
  });

  it("sends through the assigned number when it's enabled", async () => {
    const db = makeDb({
      conversation: { httpsms_config_id: "num-1", contact: { phone: "+14155550123" } },
      config: { id: "num-1", label: "Main", phone_number: "+15550000001", api_key: "enc", enabled: true, conversationCount: 3 },
    });
    vi.mocked(sendHttpSms).mockResolvedValue({ id: "prov-1", status: "pending" });

    const result = await sendHttpSmsToConversation(db, "acct-1", {
      conversationId: "cv-1",
      messageType: "text",
      contentText: "hi",
    });

    expect(sendHttpSms).toHaveBeenCalledWith(
      "dec:enc",
      expect.objectContaining({ from: "+15550000001", to: "+14155550123", content: "hi" }),
    );
    expect(result).toEqual({ messageId: "msg-1", providerMessageId: "prov-1", httpsmsConfigId: "num-1" });
  });

  it("reassigns to another enabled number when no number was ever assigned", async () => {
    const db = makeDb({
      conversation: { httpsms_config_id: null, contact: { phone: "+14155550123" } },
      otherNumbers: [
        { id: "num-2", label: "Backup", phone_number: "+15550000002", api_key: "enc2", enabled: true, conversationCount: 1 },
      ],
    });
    vi.mocked(sendHttpSms).mockResolvedValue({ id: "prov-2", status: "pending" });

    const result = await sendHttpSmsToConversation(db, "acct-1", {
      conversationId: "cv-1",
      messageType: "text",
      contentText: "hi",
    });

    expect(result.httpsmsConfigId).toBe("num-2");
  });

  it("rejects when no number was ever assigned and none are enabled", async () => {
    const db = makeDb({ conversation: { httpsms_config_id: null, contact: { phone: "+14155550123" } } });
    await expect(
      sendHttpSmsToConversation(db, "acct-1", { conversationId: "cv-1", messageType: "text", contentText: "hi" }),
    ).rejects.toMatchObject({ code: "httpsms_not_configured", status: 400 });
    expect(sendHttpSms).not.toHaveBeenCalled();
  });

  it("reassigns when the pinned number's config was deleted (dangling id)", async () => {
    const db = makeDb({
      conversation: { httpsms_config_id: "num-deleted", contact: { phone: "+14155550123" } },
      otherNumbers: [
        { id: "num-2", label: "Backup", phone_number: "+15550000002", api_key: "enc2", enabled: true, conversationCount: 0 },
      ],
    });
    vi.mocked(sendHttpSms).mockResolvedValue({ id: "prov-2", status: "pending" });

    const result = await sendHttpSmsToConversation(db, "acct-1", {
      conversationId: "cv-1",
      messageType: "text",
      contentText: "hi",
    });

    expect(result.httpsmsConfigId).toBe("num-2");
  });

  it("reassigns when the pinned number is disabled", async () => {
    const db = makeDb({
      conversation: { httpsms_config_id: "num-1", contact: { phone: "+14155550123" } },
      config: { id: "num-1", label: "Main", phone_number: "+15550000001", api_key: "enc", enabled: false, conversationCount: 5 },
      otherNumbers: [
        { id: "num-2", label: "Backup", phone_number: "+15550000002", api_key: "enc2", enabled: true, conversationCount: 0 },
      ],
    });
    vi.mocked(sendHttpSms).mockResolvedValue({ id: "prov-2", status: "pending" });

    const result = await sendHttpSmsToConversation(db, "acct-1", {
      conversationId: "cv-1",
      messageType: "text",
      contentText: "hi",
    });

    expect(result.httpsmsConfigId).toBe("num-2");
  });
});

describe("sendHttpSmsToConversation — param validation (pre-DB)", () => {
  it("requires conversation_id", async () => {
    await expect(
      sendHttpSmsToConversation(noDb(), "acct-1", { conversationId: "", messageType: "text", contentText: "hi" }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejects a non-text message_type before touching the DB", async () => {
    await expect(
      sendHttpSmsToConversation(noDb(), "acct-1", {
        conversationId: "cv-1",
        messageType: "template",
        contentText: "hi",
      }),
    ).rejects.toMatchObject({ status: 400, code: "unsupported_message_type" });
  });
});
