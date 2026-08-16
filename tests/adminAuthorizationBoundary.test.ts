import type { IncomingMessage, ServerResponse } from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  authError: null as Error | null,
  role: "user"
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient() {
    const query = {
      select() {
        return query;
      },
      eq() {
        return query;
      },
      async single() {
        return { data: { role: authState.role }, error: null };
      }
    };
    return {
      auth: {
        async getUser() {
          return {
            data: { user: authState.user },
            error: authState.authError
          };
        }
      },
      from() {
        return query;
      }
    };
  }
}));

import adminDevicesHandler from "../api/admin-devices.js";
import adminEnterprisesHandler from "../api/admin-enterprises.js";
import adminLicenseBulkHandler from "../api/admin-license-bulk.js";
import adminLicenseCodeHandler from "../api/admin-license-code.js";
import adminLicenseHandler from "../api/admin-license.js";
import adminSessionHandler from "../api/admin-session.js";
import adminWebPageHandler from "../api/admin-web-page.js";

const automationToken = "automation-token-for-tests";

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

type Endpoint = {
  readonly name: string;
  readonly method: string;
  readonly url: string;
  readonly handler: Handler;
};

type SentResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
};

const endpoints: readonly Endpoint[] = [
  { name: "license", method: "GET", url: "/api/admin-license", handler: adminLicenseHandler },
  { name: "bulk", method: "POST", url: "/api/admin-license-bulk", handler: adminLicenseBulkHandler },
  { name: "codes", method: "GET", url: "/api/admin-license-code", handler: adminLicenseCodeHandler },
  { name: "devices", method: "GET", url: "/api/admin-devices", handler: adminDevicesHandler },
  { name: "enterprises", method: "GET", url: "/api/admin-enterprises", handler: adminEnterprisesHandler },
  { name: "web-page", method: "GET", url: "/api/admin-web-page", handler: adminWebPageHandler }
];

function fakeRequest(
  endpoint: Pick<Endpoint, "method" | "url">,
  options: {
    readonly body?: string;
    readonly headers?: Record<string, string>;
  } = {}
): IncomingMessage {
  const bytes = Buffer.from(options.body || "", "utf8");
  return {
    method: endpoint.method,
    url: endpoint.url,
    headers: options.headers || {},
    socket: { remoteAddress: "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      if (bytes.length) {
        yield bytes;
      }
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

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://mock.supabase.local");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-test-key");
  vi.stubEnv("BBBB_SHARED_ADMIN_TOKEN", automationToken);
  vi.stubEnv("BBBB_ADMIN_SESSION_SECRET", "admin-session-test-secret-32-bytes-minimum");
  vi.stubEnv("BBBB_SITE_ORIGINS", "https://www.gaeideuk.com,https://gaeideuk.com");
  authState.user = null;
  authState.authError = null;
  authState.role = "user";
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("admin session bootstrap", () => {
  const endpoint = { method: "POST", url: "/api/admin-session" };

  it("returns 401 without a bearer session", async () => {
    // Given
    const { response, sent } = fakeResponse();

    // When
    await adminSessionHandler(fakeRequest(endpoint), response);

    // Then
    expect(sent.status).toBe(401);
    expect(sent.headers["set-cookie"]).toBeUndefined();
  });

  it("returns 403 for an authenticated non-admin", async () => {
    // Given
    authState.user = { id: "ordinary-user", email: "user@example.com" };
    const { response, sent } = fakeResponse();

    // When
    await adminSessionHandler(
      fakeRequest(endpoint, { headers: { authorization: "Bearer ordinary-user-token" } }),
      response
    );

    // Then
    expect(sent.status).toBe(403);
    expect(sent.headers["set-cookie"]).toBeUndefined();
  });

  it("exchanges an admin bearer session for the scoped gate cookie", async () => {
    // Given
    authState.user = { id: "admin-user", email: "admin@example.com" };
    authState.role = "admin";
    const { response, sent } = fakeResponse();

    // When
    await adminSessionHandler(
      fakeRequest(endpoint, {
        headers: {
          authorization: "Bearer admin-user-token",
          origin: "https://www.gaeideuk.com",
          "sec-fetch-site": "same-origin"
        }
      }),
      response
    );

    // Then
    expect(sent.status).toBe(200);
    expect(sent.headers["set-cookie"]).toContain("Path=/admin");
    expect(sent.headers["set-cookie"]).toContain("HttpOnly");
    expect(sent.headers["set-cookie"]).toContain("SameSite=Lax");
    expect(sent.headers["access-control-allow-origin"]).toBeUndefined();
    expect(JSON.parse(sent.body)).toEqual({
      ok: true,
      data: { expiresInSeconds: 900 }
    });
  });

  it("rejects a foreign origin before issuing a cookie", async () => {
    // Given
    authState.user = { id: "admin-user", email: "admin@example.com" };
    authState.role = "admin";
    const { response, sent } = fakeResponse();

    // When
    await adminSessionHandler(
      fakeRequest(endpoint, {
        headers: {
          authorization: "Bearer admin-user-token",
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site"
        }
      }),
      response
    );

    // Then
    expect(sent.status).toBe(403);
    expect(sent.headers["set-cookie"]).toBeUndefined();
  });

  it("reports server-authoritative owner capability without issuing a cookie", async () => {
    // Given
    authState.user = {
      id: "49ba6b61-f491-47a5-a687-97dcf4c14b61",
      email: "wobuzhi6322@gmail.com"
    };
    const { response, sent } = fakeResponse();

    // When
    await adminSessionHandler(
      fakeRequest(
        { method: "GET", url: "/api/admin-session" },
        {
          headers: {
            authorization: "Bearer owner-token",
            origin: "https://www.gaeideuk.com",
            "sec-fetch-site": "same-origin"
          }
        }
      ),
      response
    );

    // Then
    expect(sent.status).toBe(200);
    expect(sent.headers["set-cookie"]).toBeUndefined();
    expect(JSON.parse(sent.body)).toMatchObject({
      ok: true,
      data: {
        userId: "49ba6b61-f491-47a5-a687-97dcf4c14b61",
        canManageAdminRoles: true
      }
    });
  });

  it("reports delegated admin capability without trusting browser owner lists", async () => {
    // Given
    authState.user = { id: "delegated-admin", email: "admin@example.com" };
    authState.role = "admin";
    const { response, sent } = fakeResponse();

    // When
    await adminSessionHandler(
      fakeRequest(
        { method: "GET", url: "/api/admin-session" },
        {
          headers: {
            authorization: "Bearer delegated-token",
            origin: "https://www.gaeideuk.com",
            "sec-fetch-site": "same-origin"
          }
        }
      ),
      response
    );

    // Then
    expect(sent.status).toBe(200);
    expect(JSON.parse(sent.body).data.canManageAdminRoles).toBe(false);
  });
});

describe("central administrative authorization boundary", () => {
  it.each(endpoints)("returns 401 without credentials for $name", async (endpoint) => {
    // Given
    const { response, sent } = fakeResponse();

    // When
    await endpoint.handler(fakeRequest(endpoint), response);

    // Then
    expect(sent.status).toBe(401);
    expect(sent.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it.each(endpoints)("returns 401 for an invalid bearer session on $name", async (endpoint) => {
    // Given
    authState.authError = new Error("invalid-token");
    const { response, sent } = fakeResponse();

    // When
    await endpoint.handler(
      fakeRequest(endpoint, { headers: { authorization: "Bearer invalid-token" } }),
      response
    );

    // Then
    expect(sent.status).toBe(401);
  });

  it.each(endpoints)("returns 403 for an authenticated non-admin on $name", async (endpoint) => {
    // Given
    authState.user = { id: "ordinary-user", email: "user@example.com" };
    const { response, sent } = fakeResponse();

    // When
    await endpoint.handler(
      fakeRequest(endpoint, { headers: { authorization: "Bearer ordinary-user-token" } }),
      response
    );

    // Then
    expect(sent.status).toBe(403);
  });

  it("rejects a cross-site request even when it has the automation token", async () => {
    // Given
    const endpoint = endpoints[1];
    const { response, sent } = fakeResponse();

    // When
    await endpoint.handler(
      fakeRequest(endpoint, {
        headers: {
          origin: "https://attacker.example",
          "sec-fetch-site": "cross-site",
          "x-bbbb-admin-token": automationToken
        }
      }),
      response
    );

    // Then
    expect(sent.status).toBe(403);
    expect(sent.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("does not accept the automation token from a browser-origin request", async () => {
    // Given
    const endpoint = endpoints[1];
    const { response, sent } = fakeResponse();

    // When
    await endpoint.handler(
      fakeRequest(endpoint, {
        headers: {
          origin: "https://www.gaeideuk.com",
          "sec-fetch-site": "same-origin",
          "x-bbbb-admin-token": automationToken
        }
      }),
      response
    );

    // Then
    expect(sent.status).toBe(401);
  });

  it("rejects an oversized administrative JSON body before business logic", async () => {
    // Given
    const endpoint = endpoints[1];
    const body = JSON.stringify({
      action: "move-folder",
      userIds: ["x".repeat(65 * 1024)]
    });
    const { response, sent } = fakeResponse();

    // When
    await endpoint.handler(
      fakeRequest(endpoint, {
        body,
        headers: { "x-bbbb-admin-token": automationToken }
      }),
      response
    );

    // Then
    expect(sent.status).toBe(413);
  });

  it("emits a redacted structured denial event", async () => {
    // Given
    const endpoint = endpoints[0];
    const { response } = fakeResponse();
    const warning = vi.mocked(console.warn);

    // When
    await endpoint.handler(
      fakeRequest(endpoint, {
        headers: {
          authorization: "Bearer must-not-be-logged",
          cookie: "secret-cookie"
        }
      }),
      response
    );

    // Then
    expect(warning).toHaveBeenCalledOnce();
    const event = JSON.parse(String(warning.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(event.event).toBe("admin.authorization");
    expect(event.outcome).toBe("denied");
    expect(event.status).toBe(401);
    expect(JSON.stringify(event)).not.toContain("must-not-be-logged");
    expect(JSON.stringify(event)).not.toContain("secret-cookie");
  });
});
