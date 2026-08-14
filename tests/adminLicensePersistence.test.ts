import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryCall = {
  readonly method: string;
  readonly args: readonly unknown[];
};

type QueryState = {
  readonly table: string;
  calls: QueryCall[];
  payload: Record<string, unknown> | undefined;
};

type QueryResult = {
  readonly data?: unknown;
  readonly error?: { readonly message: string } | null;
};

const h = vi.hoisted(() => ({
  queries: [] as QueryState[],
  respond: ((_state: QueryState) => ({})) as (state: QueryState) => QueryResult
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      const state: QueryState = {
        table,
        calls: [],
        payload: undefined
      };
      h.queries.push(state);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "single", "update", "insert", "order", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          if ((method === "update" || method === "insert") && isRecord(args[0])) {
            state.payload = args[0];
          }
          state.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        const result = h.respond(state);
        return Promise.resolve({
          data: result.data ?? null,
          error: result.error ?? null
        }).then(onFulfilled, onRejected);
      };
      return builder;
    },
    auth: {
      getUser: async () => ({ data: { user: null }, error: null })
    }
  })
}));

import adminLicenseHandler from "../api/admin-license.js";

const adminToken = "admin-license-test-token";
const targetLicense = {
  id: "license-1",
  user_id: "user-1",
  license_code: "GD-QA-LICENSE",
  plan: "starter",
  status: "active",
  max_signatures: 17,
  max_media_mb: 257,
  max_devices: 1,
  shared_sync_enabled: false,
  feature_flags: {
    signatures: true,
    wallpapers: true,
    tagBattle: true,
    chatRace: true,
    manualOverlays: true
  },
  issued_at: "2026-08-14T00:00:00.000Z",
  activated_at: "2026-08-14T00:00:00.000Z",
  expires_at: null,
  notes: null
};

function fakeRequest(body: Record<string, unknown>, method = "PATCH"): IncomingMessage {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  return {
    method,
    url: "/api/admin-license",
    headers: { "x-bbbb-admin-token": adminToken },
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
  h.queries.length = 0;
  Object.assign(targetLicense, {
    plan: "starter",
    status: "active",
    shared_sync_enabled: false
  });
  h.respond = (state) => {
    if (state.table === "bbbb_site_profiles") {
      return {
        data: {
          user_id: "user-1",
          email: "qa@example.com",
          display_name: "QA",
          role: "user"
        }
      };
    }
    if (state.table !== "bbbb_account_licenses") {
      return {};
    }
    if (state.payload) {
      return {
        data: {
          ...targetLicense,
          ...state.payload
        }
      };
    }
    if (
      state.calls.some(
        (call) =>
          call.method === "eq" &&
          call.args[0] === "status" &&
          call.args[1] === "active"
      ) &&
      !state.calls.some((call) => call.method === "single")
    ) {
      return { data: [] };
    }
    return { data: targetLicense };
  };
});

describe("admin license detail persistence", () => {
  it("persists every manually edited field instead of plan defaults", async () => {
    const featureFlags = {
      signatures: true,
      wallpapers: false,
      tagBattle: true,
      chatRace: false,
      manualOverlays: true
    };
    const { response, sent } = fakeResponse();

    await adminLicenseHandler(
      fakeRequest({
        licenseId: targetLicense.id,
        plan: "standard",
        status: "active",
        maxSignatures: 37,
        maxMediaMb: 777,
        sharedSyncEnabled: true,
        featureFlags,
        notes: "manual admin edit"
      }),
      response
    );

    expect(sent.status).toBe(200);
    const update = h.queries.find((query) => query.payload)?.payload;
    expect(update).toMatchObject({
      plan: "standard",
      status: "active",
      max_signatures: 37,
      max_media_mb: 777,
      shared_sync_enabled: true,
      feature_flags: featureFlags
    });
  });

  it("ships the shared-sync checkbox value in the browser PATCH payload", () => {
    const source = readFileSync(new URL("../admin-private/admin.js", import.meta.url), "utf8");
    const submitStart = source.indexOf("async function handleLicenseFormSubmit()");
    const submitEnd = source.indexOf("async function handleCodeGeneratorSubmit()", submitStart);
    const submitSource = source.slice(submitStart, submitEnd);
    const payloadStart = submitSource.indexOf("const payload = {");
    const payloadEnd = submitSource.indexOf("};", payloadStart);

    expect(submitStart).toBeGreaterThanOrEqual(0);
    expect(submitEnd).toBeGreaterThan(submitStart);
    expect(payloadStart).toBeGreaterThanOrEqual(0);
    expect(submitSource.slice(payloadStart, payloadEnd)).toContain("sharedSyncEnabled");
  });

  it("persists an explicit false override", async () => {
    Object.assign(targetLicense, { plan: "pro", shared_sync_enabled: true });
    const { response, sent } = fakeResponse();

    await adminLicenseHandler(
      fakeRequest({
        licenseId: targetLicense.id,
        plan: "pro",
        status: "active",
        sharedSyncEnabled: false
      }),
      response
    );

    expect(sent.status).toBe(200);
    expect(h.queries.find((query) => query.payload)?.payload?.shared_sync_enabled).toBe(false);
  });

  it("preserves an omitted same-plan override", async () => {
    Object.assign(targetLicense, { plan: "standard", shared_sync_enabled: true });
    const { response, sent } = fakeResponse();

    await adminLicenseHandler(
      fakeRequest({
        licenseId: targetLicense.id,
        plan: "standard",
        status: "active"
      }),
      response
    );

    expect(sent.status).toBe(200);
    expect(h.queries.find((query) => query.payload)?.payload?.shared_sync_enabled).toBe(true);
  });

  it("uses the new plan default when an override is omitted", async () => {
    Object.assign(targetLicense, { plan: "pro", shared_sync_enabled: true });
    const { response, sent } = fakeResponse();

    await adminLicenseHandler(
      fakeRequest({
        licenseId: targetLicense.id,
        plan: "standard",
        status: "active"
      }),
      response
    );

    expect(sent.status).toBe(200);
    expect(h.queries.find((query) => query.payload)?.payload?.shared_sync_enabled).toBe(false);
  });

  it("persists explicit shared-sync values on license creation", async () => {
    const { response, sent } = fakeResponse();

    await adminLicenseHandler(
      fakeRequest(
        {
          userId: "user-1",
          plan: "pro",
          status: "active",
          sharedSyncEnabled: false
        },
        "POST"
      ),
      response
    );

    expect(sent.status).toBe(200);
    expect(h.queries.find((query) => query.payload)?.payload?.shared_sync_enabled).toBe(false);
  });

  it("rejects malformed shared-sync values", async () => {
    const { response, sent } = fakeResponse();

    await adminLicenseHandler(
      fakeRequest({
        licenseId: targetLicense.id,
        plan: "starter",
        status: "active",
        sharedSyncEnabled: "enabled"
      }),
      response
    );

    expect(sent.status).toBe(400);
    expect(sent.body).toContain("true 또는 false");
    expect(h.queries.some((query) => query.payload)).toBe(false);
  });
});
