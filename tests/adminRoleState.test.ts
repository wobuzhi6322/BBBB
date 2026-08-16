import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

import { describe, expect, it } from "vitest";

const runtimePath = join(process.cwd(), "admin-private", "admin-role-state.js");

function shouldRefreshTarget(input: Record<string, unknown>): unknown {
  const sandbox = { globalThis: {} };
  runInNewContext(readFileSync(runtimePath, "utf8"), sandbox);
  const runtime = Reflect.get(sandbox.globalThis, "BBBBAdminRoleState");
  const guard = Reflect.get(runtime, "shouldRefreshTarget");
  return Reflect.apply(guard, runtime, [input]);
}

describe("admin role target refresh guard", () => {
  it("refreshes when the selected target and lookup generation are unchanged", () => {
    expect(
      shouldRefreshTarget({
        targetUserId: "member-a",
        selectedUserId: "member-a",
        startedLookupRequestId: 4,
        currentLookupRequestId: 4
      })
    ).toBe(true);
  });

  it("does not replace a newer lookup whose response is still pending", () => {
    expect(
      shouldRefreshTarget({
        targetUserId: "member-a",
        selectedUserId: "member-a",
        startedLookupRequestId: 4,
        currentLookupRequestId: 5
      })
    ).toBe(false);
  });

  it("does not attach feedback to a different rendered member", () => {
    expect(
      shouldRefreshTarget({
        targetUserId: "member-a",
        selectedUserId: "member-b",
        startedLookupRequestId: 4,
        currentLookupRequestId: 4
      })
    ).toBe(false);
  });
});
