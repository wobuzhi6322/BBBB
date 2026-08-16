import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const adminSessionCookieName = "bbbb_admin_session";
const adminSessionMaxAgeSeconds = 15 * 60;

export type AdminSessionPayload = {
  sub: string;
  role: "admin";
  iat: number;
  exp: number;
};

export function issueAdminSessionCookie(req: IncomingMessage, user: { id: string }, now = Date.now()): string {
  const issuedAt = Math.floor(now / 1000);
  const payload: AdminSessionPayload = {
    sub: user.id,
    role: "admin",
    iat: issuedAt,
    exp: issuedAt + adminSessionMaxAgeSeconds
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
    const value: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const payload = adminSessionPayload(value);
    if (!payload || payload.exp * 1000 <= now) {
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
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  res.end("not-found");
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function sign(value: string): string {
  return createHmac("sha256", signingSecret()).update(value).digest("base64url");
}

function signingSecret(): string {
  const secret = process.env.BBBB_ADMIN_SESSION_SECRET;
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("BBBB_ADMIN_SESSION_SECRET must be at least 32 bytes");
  }
  return secret;
}

function adminSessionPayload(value: unknown): AdminSessionPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const sub: unknown = Reflect.get(value, "sub");
  const role: unknown = Reflect.get(value, "role");
  const issuedAt: unknown = Reflect.get(value, "iat");
  const expiresAt: unknown = Reflect.get(value, "exp");
  if (
    typeof sub !== "string" ||
    !sub ||
    role !== "admin" ||
    typeof issuedAt !== "number" ||
    !Number.isInteger(issuedAt) ||
    typeof expiresAt !== "number" ||
    !Number.isInteger(expiresAt) ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > adminSessionMaxAgeSeconds
  ) {
    return null;
  }
  return { sub, role, iat: issuedAt, exp: expiresAt };
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
