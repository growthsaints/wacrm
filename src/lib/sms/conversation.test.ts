import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveSmsConversation, SmsConversationError } from "./conversation";

interface MockDevice {
  id: string;
  label: string;
  enabled: boolean;
  sentToday: number;
}

interface MockDbOpts {
  existingConversationId?: string | null;
  devices?: MockDevice[];
  createdConversationId?: string;
}

function makeDb(opts: MockDbOpts) {
  const devices = opts.devices ?? [];
  const devicesById = new Map(devices.map((d) => [d.id, d]));
  const insertedConversationId = opts.createdConversationId ?? "conv-new";

  const from = vi.fn((table: string) => {
    if (table === "conversations") {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: opts.existingConversationId ? { id: opts.existingConversationId } : null,
                  error: null,
                }),
              }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({ data: { id: insertedConversationId }, error: null }),
          }),
        }),
      };
    }
    if (table === "sms_config") {
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({
              data: devices.filter((d) => d.enabled).map((d) => ({ id: d.id, label: d.label })),
              error: null,
            }),
          }),
        }),
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
          throw new Error("unexpected messages select shape in test");
        },
      };
    }
    throw new Error(`unexpected table: ${table}`);
  });

  return { from } as unknown as SupabaseClient;
}

describe("resolveSmsConversation", () => {
  it("returns the existing conversation without touching devices", async () => {
    const db = makeDb({ existingConversationId: "conv-1" });
    const id = await resolveSmsConversation(db, "acct-1", "user-1", "contact-1");
    expect(id).toBe("conv-1");
  });

  it("round-robins to the least-loaded device when no preference is given", async () => {
    const db = makeDb({
      existingConversationId: null,
      devices: [
        { id: "dev-1", label: "SMS Gateway", enabled: true, sentToday: 80 },
        { id: "dev-2", label: "personal", enabled: true, sentToday: 10 },
      ],
      createdConversationId: "conv-new",
    });
    const id = await resolveSmsConversation(db, "acct-1", "user-1", "contact-1");
    expect(id).toBe("conv-new");
  });

  it("pins a new conversation to the preferred device when it has capacity", async () => {
    const insert = vi.fn(() => ({
      select: () => ({ single: async () => ({ data: { id: "conv-new" }, error: null }) }),
    }));
    const db = {
      from: vi.fn((table: string) => {
        if (table === "conversations") {
          return {
            select: () => ({
              eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
            }),
            insert,
          };
        }
        if (table === "sms_config") {
          return {
            select: () => ({
              eq: () => ({
                eq: async () => ({
                  data: [
                    { id: "dev-1", label: "SMS Gateway" },
                    { id: "dev-2", label: "personal" },
                  ],
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "messages") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: (_col: string, deviceId: string) => ({
                    // dev-1 has more headroom than dev-2, but dev-2 is explicitly preferred
                    gte: async () => ({ count: deviceId === "dev-1" ? 5 : 50, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      }),
    } as unknown as SupabaseClient;

    const id = await resolveSmsConversation(db, "acct-1", "user-1", "contact-1", "dev-2");
    expect(id).toBe("conv-new");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ sms_config_id: "dev-2" }));
  });

  it("rejects when the preferred device has no capacity, without falling back to another device", async () => {
    const db = makeDb({
      existingConversationId: null,
      devices: [
        { id: "dev-1", label: "SMS Gateway", enabled: true, sentToday: 5 },
        { id: "dev-2", label: "personal", enabled: true, sentToday: 100 },
      ],
    });
    await expect(
      resolveSmsConversation(db, "acct-1", "user-1", "contact-1", "dev-2"),
    ).rejects.toMatchObject({ status: 429 });
  });

  it("rejects when the preferred device id doesn't match any enabled device", async () => {
    const db = makeDb({
      existingConversationId: null,
      devices: [{ id: "dev-1", label: "SMS Gateway", enabled: true, sentToday: 5 }],
    });
    await expect(
      resolveSmsConversation(db, "acct-1", "user-1", "contact-1", "dev-missing"),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("SmsConversationError carries a status", () => {
    const err = new SmsConversationError("boom", 429);
    expect(err.status).toBe(429);
    expect(err.name).toBe("SmsConversationError");
  });
});
