import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  notesWithLicenseCodeSharedSync,
  resolveLicenseCodeSharedSync,
  stripLicenseCodeSharedSyncFromNotes
} from "../api/_license-code-options.js";

type InsertState = {
  payload: Record<string, unknown> | undefined;
};

const h = vi.hoisted(() => ({
  inserts: [] as InsertState[]
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from() {
      const state: InsertState = { payload: undefined };
      h.inserts.push(state);
      const builder: Record<string, unknown> = {};
      builder.insert = (payload: unknown) => {
        if (isRecord(payload)) {
          state.payload = payload;
        }
        return builder;
      };
      builder.select = () => builder;
      builder.single = () => builder;
      builder.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) =>
        Promise.resolve({
          data: state.payload
            ? {
                id: "code-1",
                ...state.payload,
                created_at: "2026-08-14T00:00:00.000Z"
              }
            : null,
          error: null
        }).then(onFulfilled, onRejected);
      return builder;
    },
    auth: {
      getUser: async () => ({
        data: { user: { id: "admin-1", email: "qa-owner@example.com" } },
        error: null
      })
    }
  })
}));

vi.mock("../api/_owner.js", () => ({
  isOwnerEmail: () => true
}));

import adminLicenseCodeHandler from "../api/admin-license-code.js";

const adminToken = "admin-license-code-test-token";

function fakeRequest(body: Record<string, unknown>): IncomingMessage {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  return {
    method: "POST",
    url: "/api/admin-license-code",
    headers: { authorization: `Bearer ${adminToken}` },
    async *[Symbol.asyncIterator]() {
      yield bytes;
    }
  } as unknown as IncomingMessage;
}

type SentResponse = {
  status: number;
  body: string;
};

function fakeResponse(): { readonly response: ServerResponse; readonly sent: SentResponse } {
  const sent: SentResponse = { status: 0, body: "" };
  const response = {
    setHeader() {
      return response;
    },
    writeHead(status: number) {
      sent.status = status;
      return response;
    },
    end(chunk?: unknown) {
      if (typeof chunk === "string") {
        sent.body = chunk;
      }
    }
  };
  return {
    response: response as unknown as ServerResponse,
    sent
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://mock.supabase.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  process.env.BBBB_SHARED_ADMIN_TOKEN = adminToken;
  process.env.BBBB_OWNER_EMAILS = "qa-owner@example.com";
  h.inserts.length = 0;
});

describe("admin license-code shared sync", () => {
  it("stores the override in code metadata and returns the effective limit", async () => {
    const { response, sent } = fakeResponse();

    await adminLicenseCodeHandler(
      fakeRequest({
        mode: "account",
        plan: "standard",
        durationUnit: "unlimited",
        maxRedemptions: 1,
        notes: "shared sync QA",
        sharedSyncEnabled: true,
        featureFlags: {
          signatures: true,
          wallpapers: true,
          tagBattle: true,
          chatRace: true,
          manualOverlays: true
        }
      }),
      response
    );

    expect(sent.status, sent.body).toBe(200);
    const insert = h.inserts.find((entry) => entry.payload)?.payload;
    expect(insert?.notes).toContain("[[bbbb-license-code-shared-sync:true]]");
    const body: unknown = JSON.parse(sent.body);
    expect(body).toMatchObject({
      ok: true,
      data: {
        limits: {
          sharedSyncEnabled: true
        }
      }
    });
  });

  it("ships the code checkbox value in the browser POST payload", () => {
    const source = readFileSync(new URL("../admin-private/admin.js", import.meta.url), "utf8");
    const submitStart = source.indexOf("async function handleCodeGeneratorSubmit()");
    const submitEnd = source.indexOf("async function loadRecentCodes()", submitStart);
    const submitSource = source.slice(submitStart, submitEnd);
    const payloadStart = submitSource.indexOf("const payload = {");
    const payloadEnd = submitSource.indexOf("};", payloadStart);

    expect(submitStart).toBeGreaterThanOrEqual(0);
    expect(submitEnd).toBeGreaterThan(submitStart);
    expect(payloadStart).toBeGreaterThanOrEqual(0);
    expect(submitSource.slice(payloadStart, payloadEnd)).toContain("sharedSyncEnabled");
  });

  it("applies stored overrides in account and guest redemption", () => {
    const accountSource = readFileSync(new URL("../api/license-code.ts", import.meta.url), "utf8");
    const guestSource = readFileSync(new URL("../api/guest-license-code.ts", import.meta.url), "utf8");

    expect(accountSource).toContain(
      "resolveLicenseCodeSharedSync(limits.sharedSyncEnabled, code.notes)"
    );
    expect(guestSource).toContain(
      "resolveLicenseCodeSharedSync(limits.sharedSyncEnabled, licenseCode.notes)"
    );
  });

  it("roundtrips true and false metadata while old codes keep plan defaults", () => {
    const enabledNotes = notesWithLicenseCodeSharedSync("visible", true);
    const disabledNotes = notesWithLicenseCodeSharedSync("visible", false);

    expect(resolveLicenseCodeSharedSync(false, enabledNotes)).toBe(true);
    expect(resolveLicenseCodeSharedSync(true, disabledNotes)).toBe(false);
    expect(resolveLicenseCodeSharedSync(true, "legacy notes")).toBe(true);
    expect(stripLicenseCodeSharedSyncFromNotes(enabledNotes)).toBe("visible");
    expect(stripLicenseCodeSharedSyncFromNotes(disabledNotes)).toBe("visible");
  });

  it("stores and returns an explicit false override", async () => {
    const { response, sent } = fakeResponse();

    await adminLicenseCodeHandler(
      fakeRequest({
        mode: "account",
        plan: "pro",
        durationUnit: "unlimited",
        maxRedemptions: 1,
        sharedSyncEnabled: false
      }),
      response
    );

    expect(sent.status, sent.body).toBe(200);
    const insert = h.inserts.find((entry) => entry.payload)?.payload;
    expect(insert?.notes).toContain("[[bbbb-license-code-shared-sync:false]]");
    expect(JSON.parse(sent.body)).toMatchObject({
      data: { limits: { sharedSyncEnabled: false } }
    });
  });

  it("uses the selected plan default when the field is omitted", async () => {
    const { response, sent } = fakeResponse();

    await adminLicenseCodeHandler(
      fakeRequest({
        mode: "account",
        plan: "pro",
        durationUnit: "unlimited",
        maxRedemptions: 1
      }),
      response
    );

    expect(sent.status, sent.body).toBe(200);
    const insert = h.inserts.find((entry) => entry.payload)?.payload;
    expect(insert?.notes).toContain("[[bbbb-license-code-shared-sync:true]]");
    expect(JSON.parse(sent.body)).toMatchObject({
      data: { limits: { sharedSyncEnabled: true } }
    });
  });

  it("rejects malformed shared-sync values", async () => {
    const { response, sent } = fakeResponse();

    await adminLicenseCodeHandler(
      fakeRequest({
        mode: "account",
        plan: "standard",
        durationUnit: "unlimited",
        maxRedemptions: 1,
        sharedSyncEnabled: "enabled"
      }),
      response
    );

    expect(sent.status).toBe(400);
    expect(sent.body).toContain("true 또는 false");
    expect(h.inserts.some((entry) => entry.payload)).toBe(false);
  });
});
