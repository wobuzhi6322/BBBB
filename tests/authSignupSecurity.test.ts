import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";

import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  signUp: vi.fn(),
  upsert: vi.fn()
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient
}));

import handler from "../api/auth-signup.js";

class MockResponse {
  statusCode = 0;
  body = "";
  headers = new Map<string, string>();

  setHeader(name: string, value: string): this {
    this.headers.set(name.toLowerCase(), value);
    return this;
  }

  writeHead(statusCode: number, headers?: Record<string, string>): this {
    this.statusCode = statusCode;
    for (const [name, value] of Object.entries(headers || {})) {
      this.setHeader(name, value);
    }
    return this;
  }

  end(chunk?: string): this {
    this.body = chunk || "";
    return this;
  }
}

function request(body: Record<string, unknown>): IncomingMessage {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage;
  req.method = "POST";
  req.headers = { "content-type": "application/json" };
  return req;
}

describe("public signup email verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_ANON_KEY = "anon-key";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";

    mocks.signUp.mockResolvedValue({
      data: {
        user: {
          id: "11111111-1111-4111-8111-111111111111",
          email: "new-user@example.com"
        },
        session: null
      },
      error: null
    });
    mocks.upsert.mockResolvedValue({ error: null });
    mocks.createClient.mockImplementation((_url: string, key: string) => {
      if (key === "anon-key") {
        return { auth: { signUp: mocks.signUp } };
      }
      return {
        from: () => ({ upsert: mocks.upsert })
      };
    });
  });

  it("uses the public signup flow and requires mailbox confirmation", async () => {
    const res = new MockResponse();

    await handler(
      request({
        email: "new-user@example.com",
        password: "correct-horse-battery-staple",
        channelPlatform: "youtube",
        channelName: "새 채널",
        channelUrl: "https://youtube.com/@new"
      }),
      res as unknown as ServerResponse
    );

    expect(res.statusCode).toBe(202);
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "new-user@example.com",
      password: "correct-horse-battery-staple",
      options: {
        data: {
          channel_platform: "youtube",
          channel_name: "새 채널",
          channel_url: "https://youtube.com/@new"
        }
      }
    });
    expect(mocks.upsert).toHaveBeenCalledOnce();
    expect(JSON.parse(res.body)).toMatchObject({
      ok: true,
      data: { emailConfirmationRequired: true }
    });
  });

  it("does not immediately sign in from the browser after signup", () => {
    const source = readFileSync(join(process.cwd(), "public", "assets", "site.js"), "utf8");
    const signupBody = source.slice(
      source.indexOf("async function signUp()"),
      source.indexOf("async function sendPasswordResetEmail()")
    );

    expect(signupBody).toContain("emailConfirmationRequired");
    expect(signupBody).not.toContain("signInWithPassword");
  });
});
