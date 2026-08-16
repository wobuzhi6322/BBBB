import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("administrative role management UI contract", () => {
  it("provides an accessible owner-only action in the selected member card", () => {
    // Given
    const html = readFileSync(join(root, "admin-private", "index.html"), "utf8");

    // When
    const action = html.match(/<button[^>]+id="admin-role-action"[^>]*>/)?.[0] || "";
    const feedback = html.match(/<div[^>]+id="admin-role-feedback"[^>]*>/)?.[0] || "";
    const role = html.match(/<span[^>]+id="detail-profile-role"[^>]*>/)?.[0] || "";

    // Then
    expect(action).toContain('type="button"');
    expect(action).toContain("hidden");
    expect(feedback).toContain('aria-live="polite"');
    expect(role).toContain("user-role-badge");
  });

  it("submits compare-and-set role changes through the protected endpoint", () => {
    // Given
    const source = readFileSync(join(root, "admin-private", "admin.js"), "utf8");

    // When
    const usesRoleEndpoint = source.includes('callApi("/api/admin-role", "PATCH"');
    const sendsExpectedRole =
      source.includes("expectedRole,") &&
      source.includes("expectedRoleVersion");
    const honorsServerCapability = source.includes("canManageAdminRoles");
    const honorsImmutableOwner = source.includes("isOwner");

    // Then
    expect(usesRoleEndpoint).toBe(true);
    expect(sendsExpectedRole).toBe(true);
    expect(honorsServerCapability).toBe(true);
    expect(honorsImmutableOwner).toBe(true);
  });

  it("uses server-authoritative admin capability instead of a browser owner list", () => {
    // Given
    const source = readFileSync(join(root, "admin-private", "admin.js"), "utf8");

    // When
    const verifiesThroughServer = source.includes('callApi("/api/admin-session")');
    const duplicatesOwnerAuthority = source.includes("ownerEmails:");

    // Then
    expect(verifiesThroughServer).toBe(true);
    expect(duplicatesOwnerAuthority).toBe(false);
  });

  it("prevents stale member responses and role refreshes from replacing a newer selection", () => {
    // Given
    const source = readFileSync(join(root, "admin-private", "admin.js"), "utf8");

    // When
    const versionsLookups = source.includes("memberLookupRequestId");
    const dropsStaleResponses = source.includes("requestId !== state.memberLookupRequestId");
    const refreshesOnlySelectedTarget = source.includes(
      "state.selectedAdminProfile?.user_id === profile.user_id"
    );
    const preservesNewerPendingLookup =
      source.includes("adminRoleState.shouldRefreshTarget") &&
      source.includes("startedLookupRequestId: lookupRequestId");

    // Then
    expect(versionsLookups).toBe(true);
    expect(dropsStaleResponses).toBe(true);
    expect(refreshesOnlySelectedTarget).toBe(true);
    expect(preservesNewerPendingLookup).toBe(true);
  });
});
