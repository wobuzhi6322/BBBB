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

describe("owner role mutation transaction", () => {
  it.each([
    { current: "user", next: "admin" },
    { current: "admin", next: "user" }
  ] as const)("changes $current to $next through the audited RPC", async ({ current, next }) => {
    // Given
    if (roleState.targetProfile) {
      roleState.targetProfile.role = current;
    }

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody(next, current));

    // Then
    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body)).toMatchObject({
      ok: true,
      data: {
        profile: {
          userId: targetUserId,
          role: next,
          roleVersion: 8,
          isOwner: false
        }
      }
    });
    expect(roleState.rpcName).toBe("bbbb_owner_change_admin_role");
    expect(roleState.rpcArgs).toMatchObject({
      p_target_user_id: targetUserId,
      p_expected_role: current,
      p_expected_role_version: 7,
      p_new_role: next
    });
    expect(roleState.directUpdateAttempts).toBe(0);
  });

  it("returns success without a write when the role is already current", async () => {
    // Given
    if (roleState.targetProfile) {
      roleState.targetProfile.role = "admin";
    }

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "admin"));

    // Then
    expect(sent.status).toBe(200);
    expect(roleState.rpcCalls).toBe(0);
    expect(roleState.directUpdateAttempts).toBe(0);
  });

  it("returns a conflict instead of overwriting a newer role version", async () => {
    // Given
    roleState.forceConflict = true;

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "user"));

    // Then
    expect(sent.status).toBe(409);
    expect(JSON.parse(sent.body).code).toBe("role-conflict");
    expect(roleState.targetProfile?.role).toBe("user");
    expect(roleState.rpcCalls).toBe(1);
    expect(roleState.directUpdateAttempts).toBe(0);
  });

  it("does not report success when the atomic RPC fails", async () => {
    // Given
    roleState.rpcError = { message: "database-unavailable" };

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "user"));

    // Then
    expect(sent.status).toBe(500);
    expect(JSON.parse(sent.body).code).toBe("role-change-failed");
    expect(vi.mocked(console.info)).not.toHaveBeenCalled();
  });

  it("emits a redacted structured audit event after a role change", async () => {
    // Given
    const audit = vi.mocked(console.info);

    // When
    const sent = await invokeRole(adminRoleHandler, roleBody("admin", "user"));

    // Then
    expect(sent.status).toBe(200);
    expect(audit).toHaveBeenCalledOnce();
    const event = JSON.parse(String(audit.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(event).toMatchObject({
      event: "admin.role-change",
      outcome: "changed",
      actorUserId: ownerUserId,
      targetUserId,
      previousRole: "user",
      role: "admin",
      roleVersion: 8
    });
    expect(JSON.stringify(event)).not.toContain(ownerEmail);
    expect(JSON.stringify(event)).not.toContain("member@example.com");
  });
});
