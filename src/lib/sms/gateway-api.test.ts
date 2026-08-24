import { describe, expect, it, vi, beforeEach } from "vitest";
import { sendSms, verifyGatewayConnection, GatewayApiError } from "./gateway-api";

const creds = { baseUrl: "http://192.168.1.20:8080", username: "sms", password: "secret" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("sendSms", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("POSTs to {baseUrl}/message with Basic Auth and the expected body", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(202, { id: "msg_123", state: "Pending" }));

    const result = await sendSms(creds, {
      id: "our-id",
      phoneNumbers: ["+15551234567"],
      text: "hello",
    });

    expect(result).toEqual({ id: "msg_123", state: "Pending" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://192.168.1.20:8080/message");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(
      "Basic " + Buffer.from("sms:secret").toString("base64"),
    );
    expect(JSON.parse(init.body)).toEqual({
      id: "our-id",
      phoneNumbers: ["+15551234567"],
      textMessage: { text: "hello" },
    });
  });

  it("strips a trailing slash from baseUrl", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(202, { id: "x", state: "Pending" }));
    await sendSms(
      { ...creds, baseUrl: "http://192.168.1.20:8080/" },
      { phoneNumbers: ["+1"], text: "hi" },
    );
    expect(fetchMock.mock.calls[0][0]).toBe("http://192.168.1.20:8080/message");
  });

  it("throws GatewayApiError with the gateway's message on a non-2xx response", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(401, { message: "Unauthorized" }));

    await expect(
      sendSms(creds, { phoneNumbers: ["+1"], text: "hi" }),
    ).rejects.toMatchObject({ status: 401, message: "Unauthorized" });
  });

  it("throws GatewayApiError when the network request fails", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      sendSms(creds, { phoneNumbers: ["+1"], text: "hi" }),
    ).rejects.toBeInstanceOf(GatewayApiError);
  });

  it("throws when the response body has no id", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(202, { state: "Pending" }));

    await expect(
      sendSms(creds, { phoneNumbers: ["+1"], text: "hi" }),
    ).rejects.toBeInstanceOf(GatewayApiError);
  });
});

describe("verifyGatewayConnection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("resolves when the gateway returns 200", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(200, [{ id: "device-1" }]));
    await expect(verifyGatewayConnection(creds)).resolves.toBeUndefined();
  });

  it("throws on a 401/403 (bad credentials)", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(401, { message: "no" }));
    await expect(verifyGatewayConnection(creds)).rejects.toMatchObject({ status: 401 });
  });

  it("throws GatewayApiError when the gateway is unreachable", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new Error("timeout"));
    await expect(verifyGatewayConnection(creds)).rejects.toBeInstanceOf(GatewayApiError);
  });
});
