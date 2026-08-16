import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("database privilege boundary", () => {
  it("prevents authenticated users from writing the profile role", () => {
    // Given
    const schema = readFileSync(join(root, "supabase", "schema.sql"), "utf8");

    // When
    const normalized = schema.replace(/\s+/g, " ").toLowerCase();

    // Then
    expect(normalized).toContain("revoke update on table public.bbbb_site_profiles from authenticated");
    expect(normalized).toContain(
      "grant update (display_name, channel_platform, channel_name, channel_url, updated_at) on table public.bbbb_site_profiles to authenticated"
    );
    expect(normalized).toContain("with check (auth.uid() = user_id and role = 'user')");
    expect(normalized).not.toMatch(/grant update \([^)]*\brole\b[^)]*\) on table public\.bbbb_site_profiles to authenticated/);
    expect(normalized).not.toContain(
      "grant update on table public.bbbb_site_profiles to authenticated"
    );
  });

  it("ships an idempotent production migration for the same boundary", () => {
    // Given
    const migrationPath = join(root, "supabase", "security-hardening-20260816.sql");

    // When
    const exists = existsSync(migrationPath);

    // Then
    expect(exists).toBe(true);
    if (!exists) {
      return;
    }
    const migration = readFileSync(migrationPath, "utf8").replace(/\s+/g, " ").toLowerCase();
    expect(migration).toContain("revoke update on table public.bbbb_site_profiles from authenticated");
    expect(migration).toContain("role = 'user'");
  });

  it("changes roles and appends the audit event in one service-only transaction", () => {
    // Given
    const sqlFiles = [
      readFileSync(join(root, "supabase", "schema.sql"), "utf8"),
      readFileSync(join(root, "supabase", "security-hardening-20260816.sql"), "utf8")
    ];

    for (const sql of sqlFiles) {
      // When
      const normalized = sql.replace(/\s+/g, " ").toLowerCase();

      // Then
      expect(normalized).toContain("role_version bigint not null default 0");
      expect(normalized).toContain("create table if not exists public.bbbb_admin_role_audit");
      expect(normalized).toContain("alter table public.bbbb_admin_role_audit enable row level security");
      expect(normalized).toContain("create or replace function public.bbbb_owner_change_admin_role");
      expect(normalized).toContain("for update");
      expect(normalized).toContain("insert into public.bbbb_admin_role_audit");
      expect(normalized).toContain(
        "revoke execute on function public.bbbb_owner_change_admin_role"
      );
      expect(normalized).toContain(
        "grant execute on function public.bbbb_owner_change_admin_role"
      );
      expect(normalized).toContain("to service_role");
      expect(normalized).not.toContain(
        "grant execute on function public.bbbb_owner_change_admin_role"
          + " to authenticated"
      );
    }
  });

  it("locks immutable owner IDs and rejects nullable role CAS inputs", () => {
    const sqlFiles = [
      readFileSync(join(root, "supabase", "schema.sql"), "utf8"),
      readFileSync(join(root, "supabase", "security-hardening-20260816.sql"), "utf8")
    ];

    for (const sql of sqlFiles) {
      const normalized = sql.replace(/\s+/g, " ").toLowerCase();

      expect(normalized).toContain("create table if not exists public.bbbb_admin_owners");
      expect(normalized).toContain("49ba6b61-f491-47a5-a687-97dcf4c14b61");
      expect(normalized).toContain("fec25c39-3108-4715-a10a-62b41d6df24d");
      expect(normalized).toContain("p_expected_role is null");
      expect(normalized).toContain("p_expected_role_version is null");
      expect(normalized).toContain("p_new_role is null");
      expect(normalized).toContain(
        "where owner_record.user_id = p_actor_user_id for share"
      );
      expect(normalized).toContain(
        "where owner_record.user_id = p_target_user_id for share"
      );
      expect(normalized).toContain("raise exception 'owner role is immutable'");
      expect(normalized).toContain(
        "revoke all on table public.bbbb_admin_owners from public, anon, authenticated, service_role"
      );
      expect(normalized).toContain(
        "grant select on table public.bbbb_admin_owners to service_role"
      );
    }
  });

  it("allows the service role to append and read audits but never alter history", () => {
    const sqlFiles = [
      readFileSync(join(root, "supabase", "schema.sql"), "utf8"),
      readFileSync(join(root, "supabase", "security-hardening-20260816.sql"), "utf8")
    ];

    for (const sql of sqlFiles) {
      const normalized = sql.replace(/\s+/g, " ").toLowerCase();

      expect(normalized).toContain(
        "revoke all on table public.bbbb_admin_role_audit from public, anon, authenticated, service_role"
      );
      expect(normalized).toContain(
        "grant select, insert on table public.bbbb_admin_role_audit to service_role"
      );
      expect(normalized).not.toMatch(
        /grant\s+(truncate|update|delete)\b[^;]*bbbb_admin_role_audit[^;]*service_role/
      );
    }
  });
});

describe("deployment browser defenses", () => {
  it("applies safe baseline headers to every site response", () => {
    // Given
    const config = JSON.parse(readFileSync(join(root, "vercel.json"), "utf8")) as {
      readonly headers?: readonly {
        readonly source: string;
        readonly headers: readonly { readonly key: string; readonly value: string }[];
      }[];
    };

    // When
    const globalHeaders = config.headers?.find((entry) => entry.source === "/(.*)")?.headers || [];
    const byName = new Map(globalHeaders.map((header) => [header.key.toLowerCase(), header.value]));

    // Then
    expect(byName.get("x-content-type-options")).toBe("nosniff");
    expect(byName.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(byName.get("permissions-policy")).toContain("camera=()");
  });

  it("pins the privileged browser SDK and verifies its bytes", () => {
    // Given
    const html = readFileSync(join(root, "admin-private", "index.html"), "utf8");

    // When
    const scriptTag = html.match(/<script[^>]+supabase-js[^>]+><\/script>/)?.[0] || "";
    const browserBundle = readFileSync(
      join(root, "node_modules", "@supabase", "supabase-js", "dist", "umd", "supabase.js")
    );
    const expectedIntegrity = `sha384-${createHash("sha384").update(browserBundle).digest("base64")}`;

    // Then
    expect(scriptTag).toContain("@supabase/supabase-js@2.105.4/dist/umd/supabase.js");
    expect(scriptTag).toContain(`integrity="${expectedIntegrity}"`);
    expect(scriptTag).toContain('crossorigin="anonymous"');
  });

  it("declares the security-critical deployment variables", () => {
    // Given
    const example = readFileSync(join(root, ".env.example"), "utf8");

    // When
    const keys = new Set(
      example
        .split(/\r?\n/)
        .filter((line) => line.includes("="))
        .map((line) => line.split("=")[0])
    );

    // Then
    expect(keys.has("BBBB_ADMIN_SESSION_SECRET")).toBe(true);
    expect(keys.has("BBBB_SITE_ORIGINS")).toBe(true);
    expect(keys.has("BBBB_OWNER_USER_IDS")).toBe(true);
  });

  it("keeps the environment example trackable without exposing local secrets", () => {
    // Given
    const ignoreRules = readFileSync(join(root, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim());

    // When
    const exampleIsUnignored = ignoreRules.includes("!.env.example");

    // Then
    expect(exampleIsUnignored).toBe(true);
  });
});
