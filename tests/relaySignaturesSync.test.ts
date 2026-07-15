import { createServer } from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => {
  const upsert = vi.fn(async (..._args: unknown[]) => ({ error: null }));
  const selectEq = vi.fn(
    async (): Promise<{ data: { local_signature_id: string }[]; error: null }> => ({ data: [], error: null })
  );
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
  return { client: { from }, upsert, selectEq };
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
            media_type: "video",
            // 신규 행은 기본 공개 — "동기화 후 하나씩 켜기" 제거 (2026-07-15)
            published: true
          })
        ],
        // ignoreDuplicates: 동시 동기화 경쟁 시 형제 요청의 행을 덮어쓰지 않음
        { onConflict: "page_id,local_signature_id", ignoreDuplicates: true }
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it("기존 행 upsert에는 published를 싣지 않는다 (스튜디오 소유 값 보존)", async () => {
    database.selectEq.mockResolvedValueOnce({
      data: [{ local_signature_id: "sig-1" }],
      error: null
    });
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
            { local_signature_id: "sig-1", title: "영상 시그", amount: 5000, media_type: "video", thumb: null },
            { local_signature_id: "sig-2", title: "신규 시그", amount: 9000, media_type: "audio", thumb: null }
          ]
        })
      });

      expect(response.status).toBe(200);
      // 1번째 호출 = 기존 행(sig-1, published 없음), 2번째 호출 = 신규 행(sig-2, published:true)
      expect(database.upsert).toHaveBeenCalledTimes(2);
      const knownPayload = database.upsert.mock.calls[0]?.[0] as Record<string, unknown>[];
      expect(knownPayload).toHaveLength(1);
      expect(knownPayload[0]?.local_signature_id).toBe("sig-1");
      expect("published" in (knownPayload[0] ?? {})).toBe(false);
      const newPayload = database.upsert.mock.calls[1]?.[0] as Record<string, unknown>[];
      expect(newPayload).toHaveLength(1);
      expect(newPayload[0]).toEqual(
        expect.objectContaining({ local_signature_id: "sig-2", published: true })
      );
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
});
