import type { IncomingMessage, ServerResponse } from "node:http";

import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryState = {
  readonly table: string;
  calls: { readonly method: string; readonly args: readonly unknown[] }[];
  payload: Record<string, unknown> | undefined;
};

type CodeFixture = {
  readonly id: string;
  readonly code_prefix: string;
  readonly plan: string;
  readonly duration_hours: null;
  readonly max_redemptions: number;
  readonly redeemed_count: number;
  readonly valid_until: null;
  readonly is_active: true;
  readonly feature_flags: Record<string, boolean>;
  readonly notes: string | null;
};

const h = vi.hoisted(() => ({
  code: undefined as CodeFixture | undefined,
  existingLicense: undefined as Record<string, unknown> | undefined,
  licensePayloads: [] as Record<string, unknown>[]
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      const state: QueryState = { table, calls: [], payload: undefined };
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "single", "maybeSingle", "insert", "update", "upsert", "order", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          if (["insert", "update", "upsert"].includes(method) && isRecord(args[0])) {
            state.payload = args[0];
          }
          state.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (
        onFulfilled?: (value: unknown) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => Promise.resolve(queryResult(state)).then(onFulfilled, onRejected);
      return builder;
    },
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1", email: "qa@example.com" } },
        error: null
      })
    }
  })
}));

import guestLicenseCodeHandler from "../api/guest-license-code.js";
import licenseCodeHandler from "../api/license-code.js";

function queryResult(state: QueryState): { readonly data: unknown; readonly error: null } {
  if (state.table === "bbbb_site_profiles") {
    return { data: null, error: null };
  }
  if (state.table === "bbbb_license_codes") {
    const selection = state.calls.find((call) => call.method === "select")?.args[0];
    const selectedCode =
      typeof selection === "string" && !selection.split(",").includes("notes") && h.code
        ? { ...h.code, notes: undefined }
        : h.code;
    return {
      data: state.calls.some((call) => call.method === "select") ? selectedCode : null,
      error: null
    };
  }
  if (state.table === "bbbb_license_code_redemptions") {
    if (state.calls.some((call) => call.method === "insert")) {
      return { data: { id: "redemption-1" }, error: null };
    }
    return { data: null, error: null };
  }
  if (state.table === "bbbb_account_licenses") {
    if (
      state.calls.some((call) => call.method === "insert" || call.method === "update") &&
      state.payload
    ) {
      h.licensePayloads.push(state.payload);
      const selectedFields = state.calls.find((call) => call.method === "select")?.args[0];
      const row: Record<string, unknown> = {
        id: "license-1",
        ...state.payload
      };
      return {
        data:
          typeof selectedFields === "string"
            ? Object.fromEntries(
                selectedFields
                  .split(",")
                  .map((field) => field.trim())
                  .filter((field) => field in row)
                  .map((field) => [field, row[field]])
              )
            : row,
        error: null
      };
    }
    return { data: h.existingLicense ?? null, error: null };
  }
  return { data: null, error: null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fakeRequest(body: Record<string, unknown>): IncomingMessage {
  const bytes = Buffer.from(JSON.stringify(body), "utf8");
  return {
    method: "POST",
    url: "/api/license-code",
    headers: { authorization: "Bearer qa-session-token" },
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

function codeFixture(prefix: "GD-ACC" | "GD-GST", plan: "standard" | "pro", notes: string | null): CodeFixture {
  return {
    id: "code-1",
    code_prefix: prefix,
    plan,
    duration_hours: null,
    max_redemptions: 10,
    redeemed_count: 0,
    valid_until: null,
    is_active: true,
    feature_flags: {
      signatures: true,
      wallpapers: true,
      tagBattle: true,
      chatRace: true,
      manualOverlays: true
    },
    notes
  };
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://mock.supabase.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  h.code = undefined;
  h.existingLicense = undefined;
  h.licensePayloads.length = 0;
});

describe("license-code shared-sync redemption", () => {
  it.each([
    ["standard", "[[bbbb-license-code-shared-sync:true]]", true],
    ["pro", "[[bbbb-license-code-shared-sync:false]]", false],
    ["pro", "legacy code notes", true]
  ] as const)("account redemption applies %s metadata", async (plan, notes, expected) => {
    h.code = codeFixture("GD-ACC", plan, notes);
    const { response, sent } = fakeResponse();

    await licenseCodeHandler(fakeRequest({ code: "GD-ACC-QA-CODE" }), response);

    expect(sent.status, sent.body).toBe(200);
    expect(h.licensePayloads).toHaveLength(1);
    expect(h.licensePayloads[0]?.shared_sync_enabled).toBe(expected);
    expect(JSON.parse(sent.body)).toMatchObject({
      data: { license: { shared_sync_enabled: expected } }
    });
  });

  it.each([
    ["standard", "[[bbbb-license-code-shared-sync:true]]", true],
    ["pro", "[[bbbb-license-code-shared-sync:false]]", false],
    ["pro", "legacy code notes", true]
  ] as const)("guest redemption applies %s metadata", async (plan, notes, expected) => {
    h.code = codeFixture("GD-GST", plan, notes);
    const { response, sent } = fakeResponse();

    await guestLicenseCodeHandler(fakeRequest({ code: "GD-GST-QA-CODE" }), response);

    expect(sent.status, sent.body).toBe(200);
    expect(JSON.parse(sent.body)).toMatchObject({
      data: { license: { shared_sync_enabled: expected } }
    });
  });

  it("updates an existing account license with the stored override", async () => {
    h.code = codeFixture("GD-ACC", "standard", "[[bbbb-license-code-shared-sync:true]]");
    h.existingLicense = {
      id: "existing-license-1",
      license_code: "LC-EXISTING",
      plan: "starter",
      status: "active",
      expires_at: null,
      activated_at: "2026-08-14T00:00:00.000Z",
      notes: null
    };
    const { response, sent } = fakeResponse();

    await licenseCodeHandler(fakeRequest({ code: "GD-ACC-QA-CODE" }), response);

    expect(sent.status, sent.body).toBe(200);
    expect(h.licensePayloads).toHaveLength(1);
    expect(h.licensePayloads[0]?.shared_sync_enabled).toBe(true);
    expect(JSON.parse(sent.body)).toMatchObject({
      data: {
        license: {
          id: "license-1",
          shared_sync_enabled: true
        }
      }
    });
  });
});
