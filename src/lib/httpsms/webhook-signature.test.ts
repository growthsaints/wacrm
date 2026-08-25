import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyHttpSmsWebhookAuth } from "./webhook-signature";

const SECRET = "test-httpsms-signing-key";

function makeJwt(payload: object, secret: string = SECRET, alg = "HS256"): string {
  const header = Buffer.from(JSON.stringify({ alg, typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

describe("verifyHttpSmsWebhookAuth", () => {
  it("accepts a valid HS256 JWT signed with the correct secret", () => {
    const token = makeJwt({ iat: 1700000000 });
    expect(verifyHttpSmsWebhookAuth(`Bearer ${token}`, SECRET)).toBe(true);
  });

  it("is case-insensitive on the Bearer prefix", () => {
    const token = makeJwt({ iat: 1 });
    expect(verifyHttpSmsWebhookAuth(`bearer ${token}`, SECRET)).toBe(true);
  });

  it("rejects a token signed with a different secret", () => {
    const token = makeJwt({ iat: 1 }, "wrong-secret");
    expect(verifyHttpSmsWebhookAuth(`Bearer ${token}`, SECRET)).toBe(false);
  });

  it("rejects a tampered payload", () => {
    const token = makeJwt({ iat: 1 });
    const [header, , signature] = token.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ iat: 999999 })).toString("base64url");
    expect(verifyHttpSmsWebhookAuth(`Bearer ${header}.${tamperedPayload}.${signature}`, SECRET)).toBe(false);
  });

  it("rejects a non-HS256 alg header", () => {
    const token = makeJwt({ iat: 1 }, SECRET, "none");
    expect(verifyHttpSmsWebhookAuth(`Bearer ${token}`, SECRET)).toBe(false);
  });

  it("rejects a missing Authorization header", () => {
    expect(verifyHttpSmsWebhookAuth(null, SECRET)).toBe(false);
  });

  it("rejects a header without the Bearer prefix", () => {
    const token = makeJwt({ iat: 1 });
    expect(verifyHttpSmsWebhookAuth(token, SECRET)).toBe(false);
  });

  it("rejects a malformed token (wrong segment count)", () => {
    expect(verifyHttpSmsWebhookAuth("Bearer not.a.valid.jwt", SECRET)).toBe(false);
    expect(verifyHttpSmsWebhookAuth("Bearer onlyonesegment", SECRET)).toBe(false);
  });

  it("rejects an unparseable header segment", () => {
    expect(verifyHttpSmsWebhookAuth("Bearer !!!.abc.def", SECRET)).toBe(false);
  });
});
