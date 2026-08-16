import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createAdminRoleClient,
  invokeRole,
  ownerEmail,
  ownerUserId,
  resetRoleState,
  roleBody,
  roleState,
  targetUserId,
  type RoleHandler
} from "./helpers/adminRoleHarness.js";

let adminRoleHandler: RoleHandler;

beforeAll(async () => {
  vi.doMock("@supabase/supabase-js", () => ({
    createClient: createAdminRoleClient
  }));
  adminRoleHandler = (await import("../api/admin-role.js")).default;
});

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://mock.supabase.local");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
  vi.stubEnv("BBBB_OWNER_USER_IDS", ownerUserId);
  vi.stubEnv("BBBB_SITE_ORIGINS", "https://www.gaeideuk.com");
  resetRoleState();
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

afterAll(() => {
  vi.doUnmock("@supabase/supabase-js");
});

describe("owner role mutation boundary", () => {
  it("rejects a delegated administrator before any role write", async () => {
    // Given
    roleState.actor = { id: "delegated-admin", email: "admin@example.com" };
    roleState.actorRole = "admin";

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "user"));

    // Then
    expect(sent.status).toBe(403);
    expect(JSON.parse(sent.body).code).toBe("owner-required");
    expectNoMutation();
  });

  it("rejects an originless automation token", async () => {
    // Given / When
    const sent = await invokeRole(
      adminRoleHandler,
      roleBody("admin", "user"),
      { "x-bbbb-admin-token": "automation-token-for-tests" }
    );

    // Then
    expect(sent.status).toBe(403);
    expectNoMutation();
  });

  it("requires a valid owner bearer after accepting the browser origin", async () => {
    // Given
    const headers = allowedHeaders();
    delete headers.authorization;

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "user"), headers);

    // Then
    expect(sent.status).toBe(401);
    expectNoMutation();
  });

  it("rejects an invalid owner bearer", async () => {
    // Given
    roleState.actorError = new Error("invalid-token");

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "user"));

    // Then
    expect(sent.status).toBe(401);
    expectNoMutation();
  });

  it("rejects a cross-site request before authenticating", async () => {
    // Given
    const headers = {
      ...allowedHeaders(),
      origin: "https://attacker.example",
      "sec-fetch-site": "cross-site"
    };

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "user"), headers);

    // Then
    expect(sent.status).toBe(403);
    expect(roleState.getUserCalls).toBe(0);
    expectNoMutation();
  });

  it("requires JSON content for a privileged mutation", async () => {
    // Given
    const headers = { ...allowedHeaders(), "content-type": "text/plain" };

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "user"), headers);

    // Then
    expect(sent.status).toBe(415);
    expectNoMutation();
  });

  it("prevents changing a configured owner resolved from Supabase Auth", async () => {
    // Given
    roleState.targetProfile = {
      user_id: ownerUserId,
      email: ownerEmail,
      role: "admin",
      role_version: 7
    };
    roleState.targetAuthUserId = ownerUserId;
    roleState.targetAuthEmail = ownerEmail;

    // When
    const sent = await invokeRole(
      adminRoleHandler,
      JSON.stringify({
        userId: ownerUserId,
        role: "user",
        expectedRole: "admin",
        expectedRoleVersion: 7
      })
    );

    // Then
    expect(sent.status).toBe(409);
    expect(JSON.parse(sent.body).code).toBe("owner-role-immutable");
    expectNoMutation();
  });

  it.each([
    {},
    { userId: "not-a-uuid", role: "admin", expectedRole: "user", expectedRoleVersion: 7 },
    { userId: targetUserId, role: "owner", expectedRole: "user", expectedRoleVersion: 7 },
    { userId: targetUserId, role: "admin", expectedRole: "owner", expectedRoleVersion: 7 },
    { userId: targetUserId, role: "admin", expectedRole: "user", expectedRoleVersion: -1 },
    { userId: targetUserId, role: "admin", expectedRole: "user", expectedRoleVersion: 7, actorEmail: ownerEmail }
  ])("rejects malformed or forged commands %#", async (body) => {
    // Given / When
    const sent = await invokeRole(adminRoleHandler, JSON.stringify(body));

    // Then
    expect(sent.status).toBe(400);
    expectNoMutation();
  });

  it("returns 404 when the target profile does not exist", async () => {
    // Given
    roleState.targetProfile = null;

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "user"));

    // Then
    expect(sent.status).toBe(404);
    expectNoMutation();
  });

  it("returns 500 instead of hiding a profile database outage as a missing user", async () => {
    // Given
    roleState.profileReadError = { code: "PGRST500", message: "database-unavailable" };

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "user"));

    // Then
    expect(sent.status).toBe(500);
    expect(JSON.parse(sent.body).code).toBe("role-change-failed");
    expectNoMutation();
  });

  it("returns 500 instead of hiding an Auth service outage as a missing user", async () => {
    // Given
    roleState.targetAuthError = Object.assign(new Error("auth-unavailable"), { status: 503 });

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "user"));

    // Then
    expect(sent.status).toBe(500);
    expect(JSON.parse(sent.body).code).toBe("role-change-failed");
    expectNoMutation();
  });

  it("rejects an oversized command before mutation", async () => {
    // Given
    const body = JSON.stringify({
      userId: targetUserId,
      role: "admin",
      expectedRole: "user",
      expectedRoleVersion: 7,
      padding: "x".repeat(3 * 1024)
    });

    // When
    const sent = await invokeRole(adminRoleHandler, body);

    // Then
    expect(sent.status).toBe(413);
    expectNoMutation();
  });
});

function allowedHeaders(): Record<string, string> {
  return {
    authorization: "Bearer owner-token",
    origin: "https://www.gaeideuk.com",
    "sec-fetch-site": "same-origin",
    "content-type": "application/json"
  };
}

function expectNoMutation(): void {
  expect(roleState.rpcCalls).toBe(0);
  expect(roleState.directUpdateAttempts).toBe(0);
}
