import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminSessionCookieName,
  issueAdminSessionCookie
} from "../api/_admin-session.js";
import adminAssetHandler from "../api/admin-asset.js";
import adminHandler from "../api/admin.js";

const sessionSecret = "admin-session-test-secret-32-bytes-minimum";
const root = process.cwd();

type SentResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
};

function fakeRequest(
  url: string,
  options: { readonly method?: string; readonly cookie?: string } = {}
): IncomingMessage {
  return {
    method: options.method || "GET",
    url,
    headers: {
      host: "www.gaeideuk.com",
      ...(options.cookie ? { cookie: options.cookie } : {})
    }
  } as unknown as IncomingMessage;
}

function fakeResponse(): { readonly response: ServerResponse; readonly sent: SentResponse } {
  const sent: SentResponse = { status: 0, body: "", headers: {} };
  const response = {
    setHeader(name: string, value: number | string | readonly string[]) {
      sent.headers[name.toLowerCase()] = String(value);
      return response;
    },
    writeHead(status: number, headers?: Record<string, number | string | readonly string[]>) {
      sent.status = status;
      for (const [name, value] of Object.entries(headers || {})) {
        sent.headers[name.toLowerCase()] = String(value);
      }
      return response;
    },
    end(chunk?: unknown) {
      if (typeof chunk === "string") {
        sent.body = chunk;
      }
    }
  };
  return { response: response as unknown as ServerResponse, sent };
}

function validCookie(): string {
  const request = fakeRequest("/admin/");
  return issueAdminSessionCookie(request, { id: "admin-user" }).split(";")[0] || "";
}

beforeEach(() => {
  vi.stubEnv("BBBB_ADMIN_SESSION_SECRET", sessionSecret);
  vi.stubEnv("BBBB_SHARED_ADMIN_TOKEN", "legacy-shared-token");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "legacy-service-role-key");
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin gate bootstrap", () => {
  it("creates the gate session before navigating from the authenticated public site", () => {
    // Given
    const source = readFileSync(join(root, "public", "assets", "site.js"), "utf8");

    // When
    const sessionExchange = source.indexOf('postJsonWithAuth("/api/admin-session", token, {})');
    const adminNavigation = source.indexOf('window.location.href = "/admin/"', sessionExchange);

    // Then
    expect(sessionExchange).toBeGreaterThanOrEqual(0);
    expect(adminNavigation).toBeGreaterThan(sessionExchange);
  });
});

describe("admin session secret isolation", () => {
  it("issues a gate cookie using only the dedicated secret", () => {
    // Given
    vi.stubEnv("BBBB_SHARED_ADMIN_TOKEN", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");

    // When
    const cookie = issueAdminSessionCookie(fakeRequest("/admin/"), { id: "admin-user" });

    // Then
    expect(cookie).toContain(`${adminSessionCookieName}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/admin");
  });

  it("does not reuse legacy administrative or service-role secrets", () => {
    // Given
    vi.stubEnv("BBBB_ADMIN_SESSION_SECRET", "");

    // When
    const issue = () => issueAdminSessionCookie(fakeRequest("/admin/"), { id: "admin-user" });

    // Then
    expect(issue).toThrow("BBBB_ADMIN_SESSION_SECRET");
  });
});

describe("admin file gate", () => {
  it.each([
    ["/admin/", adminHandler],
    ["/admin/index.html", adminHandler],
    ["/api/admin-asset?file=admin-role-state.js", adminAssetHandler],
    ["/api/admin-asset?file=admin.js", adminAssetHandler]
  ])("returns an indistinguishable 404 without a gate for %s", async (url, handler) => {
    // Given
    const { response, sent } = fakeResponse();

    // When
    await handler(fakeRequest(url), response);

    // Then
    expect(sent.status).toBe(404);
    expect(sent.body).toBe("not-found");
    expect(sent.headers["cache-control"]).toBe("no-store");
    expect(sent.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("serves the dashboard with a valid short-lived gate", async () => {
    // Given
    const { response, sent } = fakeResponse();

    // When
    await adminHandler(fakeRequest("/admin/", { cookie: validCookie() }), response);

    // Then
    expect(sent.status).toBe(200);
    expect(sent.headers["content-type"]).toBe("text/html; charset=utf-8");
    expect(sent.body.length).toBeGreaterThan(1000);
  });

  it("rejects a tampered gate cookie", async () => {
    // Given
    const { response, sent } = fakeResponse();
    const cookie = `${validCookie()}tampered`;

    // When
    await adminHandler(fakeRequest("/admin/", { cookie }), response);

    // Then
    expect(sent.status).toBe(404);
  });

  it("serves only allowlisted assets behind the same gate", async () => {
    // Given
    const { response, sent } = fakeResponse();

    // When
    await adminAssetHandler(
      fakeRequest("/api/admin-asset?file=admin.js", { cookie: validCookie() }),
      response
    );

    // Then
    expect(sent.status).toBe(200);
    expect(sent.headers["content-type"]).toBe("application/javascript; charset=utf-8");
    expect(sent.body.length).toBeGreaterThan(1000);
  });
});

describe("admin browser defense headers", () => {
  it("enforces clickjacking, MIME, referrer, capability, and CSP defenses", async () => {
    // Given
    const { response, sent } = fakeResponse();

    // When
    await adminHandler(fakeRequest("/admin/", { cookie: validCookie() }), response);

    // Then
    expect(sent.headers["x-content-type-options"]).toBe("nosniff");
    expect(sent.headers["referrer-policy"]).toBe("no-referrer");
    expect(sent.headers["x-frame-options"]).toBe("DENY");
    expect(sent.headers["permissions-policy"]).toContain("camera=()");
    expect(sent.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(sent.headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(sent.headers["content-security-policy"]).toContain("object-src 'none'");
    expect(sent.headers["content-security-policy"]).toContain("https://project.supabase.co");
  });
});
