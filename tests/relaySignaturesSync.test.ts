import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const upsert = vi.fn(async () => ({ error: null }));
  const selectEq = vi.fn(async () => ({ data: [], error: null }));
  const updateEq = vi.fn(async () => ({ error: null }));
  const signaturesTable = {
    upsert,
    select: vi.fn(() => ({ eq: selectEq }))
  };
  const relayDevicesTable = {
    update: vi.fn(() => ({ eq: updateEq }))
  };
  const from = vi.fn((table: string) => {
    if (table === "bbbb_page_signatures") return signaturesTable;
    if (table === "bbbb_relay_devices") return relayDevicesTable;
    throw new Error(`Unexpected table: ${table}`);
  });
  return { client: { from }, upsert };
});

vi.mock("../api/_webServer.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../api/_webServer.js")>();
  return {
    ...original,
    serviceClient: () => database.client,
    authenticateRelayDevice: async () => ({
      ok: true,
      device: {
        id: "device-1",
        page_id: "page-1",
        active: true,
        signatures_dirty: true,
        last_heartbeat_at: null
      }
    })
  };
});

import handler from "../api/relay/signatures-sync.js";

describe("relay signature sync", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("accepts the documented snake-case payload from the desktop program", async () => {
    const server = createServer(handler);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });

    try {
      const address = server.address();
      if (address === null || typeof address === "string") {
        throw new Error("HTTP test server did not expose a TCP address");
      }
      const response = await fetch(`http://127.0.0.1:${address.port}/api/relay/signatures-sync`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signatures: [
            {
              local_signature_id: "sig-1",
              title: "영상 시그",
              amount: 5000,
              media_type: "video",
              thumb: null
            }
          ]
        })
      });
      const body: unknown = await response.json();

      expect(response.status).toBe(200);
      expect(body).toEqual({
        ok: true,
        data: { upserted: 1, deleted: 0, thumbSkipped: [], thumbFailed: [] }
      });
      expect(database.upsert).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            page_id: "page-1",
            local_signature_id: "sig-1",
            title: "영상 시그",
            amount: 5000,
            media_type: "video"
          })
        ],
        { onConflict: "page_id,local_signature_id" }
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
