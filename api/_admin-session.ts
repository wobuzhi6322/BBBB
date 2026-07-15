import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const adminSessionCookieName = "bbbb_admin_session";
const adminSessionMaxAgeSeconds = 15 * 60;

export type AdminSessionPayload = {
  sub: string;
  email: string | null;
  role: "admin";
  exp: number;
};

export function issueAdminSessionCookie(req: IncomingMessage, user: { id: string; email?: string | null }, now = Date.now()): string {
  const payload: AdminSessionPayload = {
    sub: user.id,
    email: user.email || null,
    role: "admin",
    exp: Math.floor((now + adminSessionMaxAgeSeconds * 1000) / 1000)
  };
  const body = base64UrlEncode(JSON.stringify(payload));
  return serializeCookie(req, `${body}.${sign(body)}`, adminSessionMaxAgeSeconds);
}

export function clearAdminSessionCookie(req: IncomingMessage): string {
  return serializeCookie(req, "", 0);
}

export function verifyAdminSession(req: IncomingMessage, now = Date.now()): AdminSessionPayload | null {
  const value = parseCookies(req.headers.cookie)[adminSessionCookieName];
  if (!value) {
    return null;
  }

  const parts = value.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const [body, signature] = parts;
  if (!safeEqual(signature, sign(body))) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as AdminSessionPayload;
    if (payload.role !== "admin" || !payload.sub || payload.exp * 1000 <= now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function sendNotFound(res: ServerResponse): void {
  res.writeHead(404, {
    "content-type": "text/plain; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end("not-found");
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function sign(value: string): string {
  return createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

function signingSecret(): string {
  const secret = process.env.BBBB_SHARED_ADMIN_TOKEN || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) {
    throw new Error("BBBB_SHARED_ADMIN_TOKEN or SUPABASE_SERVICE_ROLE_KEY is required");
  }
  return secret;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function serializeCookie(req: IncomingMessage, value: string, maxAge: number): string {
  const secure = shouldUseSecureCookie(req) ? "; Secure" : "";
  return `${adminSessionCookieName}=${value}; Max-Age=${maxAge}; Path=/admin; HttpOnly; SameSite=Lax${secure}`;
}

function shouldUseSecureCookie(req: IncomingMessage): boolean {
  const host = headerValue(req.headers.host) || "";
  return !host.startsWith("localhost") && !host.startsWith("127.0.0.1");
}

function parseCookies(value: string | string[] | undefined): Record<string, string> {
  const cookieHeader = headerValue(value);
  if (!cookieHeader) {
    return {};
  }
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        if (index === -1) {
          return [part, ""];
        }
        return [part.slice(0, index), part.slice(index + 1)];
      })
  );
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}
