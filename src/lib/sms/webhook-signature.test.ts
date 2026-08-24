import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifySmsWebhookSignature } from "./webhook-signature";

const SECRET = "test-sms-webhook-secret";

function sign(body: string, timestamp: string, secret: string = SECRET): string {
  return crypto.createHmac("sha256", secret).update(body + timestamp).digest("hex");
}

describe("verifySmsWebhookSignature", () => {
  it("accepts a request signed with the correct secret and a fresh timestamp", () => {
    const body = JSON.stringify({ event: "sms:received" });
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySmsWebhookSignature(body, sign(body, ts), ts, SECRET)).toBe(true);
  });

  it("rejects a signature computed with a different secret", () => {
    const body = "{}";
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySmsWebhookSignature(body, sign(body, ts, "wrong"), ts, SECRET)).toBe(false);
  });

  it("rejects when the body has been tampered with after signing", () => {
    const original = '{"event":"sms:received"}';
    const ts = String(Math.floor(Date.now() / 1000));
    const signature = sign(original, ts);
    const tampered = '{"event":"sms:sent"}';
    expect(verifySmsWebhookSignature(tampered, signature, ts, SECRET)).toBe(false);
  });

  it("rejects a missing signature or timestamp header", () => {
    expect(verifySmsWebhookSignature("{}", null, "123", SECRET)).toBe(false);
    expect(verifySmsWebhookSignature("{}", "abc", null, SECRET)).toBe(false);
  });

  it("rejects a non-numeric timestamp", () => {
    expect(verifySmsWebhookSignature("{}", "abc", "not-a-number", SECRET)).toBe(false);
  });

  it("rejects a signature of the wrong length without throwing", () => {
    const ts = String(Math.floor(Date.now() / 1000));
    expect(verifySmsWebhookSignature("{}", "tooshort", ts, SECRET)).toBe(false);
  });

  it("rejects a timestamp outside the allowed skew window", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const body = "{}";
    const staleTs = String(Math.floor(Date.now() / 1000) - 10 * 60); // 10 min old
    const signature = sign(body, staleTs);
    expect(verifySmsWebhookSignature(body, signature, staleTs, SECRET)).toBe(false);
    vi.useRealTimers();
  });
});
