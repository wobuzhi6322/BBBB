import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { isOwnerUserId } from "../api/_owner.js";

const root = process.cwd();
const defaultOwnerIds = [
  "49ba6b61-f491-47a5-a687-97dcf4c14b61",
  "fec25c39-3108-4715-a10a-62b41d6df24d"
];

describe("immutable owner identity", () => {
  it("recognizes only provisioned Auth user IDs", () => {
    for (const userId of defaultOwnerIds) {
      expect(isOwnerUserId(userId)).toBe(true);
    }
    expect(isOwnerUserId("wobuzhi6322@gmail.com")).toBe(false);
    expect(isOwnerUserId("11111111-1111-4111-8111-111111111111")).toBe(false);
  });

  it("contains no email-based owner authorization callsites", () => {
    const apiRoot = join(root, "api");
    const files = readdirSync(apiRoot)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => join(apiRoot, name));
    const source = files.map((file) => readFileSync(file, "utf8")).join("\n");

    expect(source).not.toContain("isOwnerEmail");
    expect(source).not.toContain("BBBB_OWNER_EMAILS");
  });
});
