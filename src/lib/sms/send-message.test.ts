import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { sendSmsToConversation, SmsSendError, validateSendSmsParams } from "./send-message";

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
