import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isOwnerUserId } from "./_owner.js";

const profilesTable = "bbbb_site_profiles";
const defaultSiteOrigins = [
  "https://www.gaeideuk.com",
  "https://gaeideuk.com",
  "http://localhost:3000",
  "http://127.0.0.1:3000"
] as const;

type AdminDenial = {
  readonly status: 401 | 403;
  readonly code: "admin-required" | "forbidden-origin" | "invalid-session" | "owner-required";
  readonly message: string;
};

export type AdminUserPrincipal = {
  readonly kind: "user";
  readonly userId: string;
  readonly email: string | null;
};

export type AdminPrincipal =
  | AdminUserPrincipal
  | {
      readonly kind: "automation";
      readonly userId: null;
      readonly email: null;
    };

export class AdminRequestError extends Error {
  readonly status: 401 | 403;
  readonly code: AdminDenial["code"];

  constructor(denial: AdminDenial) {
    super(denial.message);
    this.name = "AdminRequestError";
    this.status = denial.status;
    this.code = denial.code;
  }
}

export async function requireAdmin(
  req: IncomingMessage,
  supabase: SupabaseClient
): Promise<AdminPrincipal> {
  assertAdminOrigin(req);
  if (hasValidAutomationToken(req)) {
    return { kind: "automation", userId: null, email: null };
  }
  return requireAdminUserAfterOrigin(req, supabase);
}

export async function requireAdminUser(
  req: IncomingMessage,
  supabase: SupabaseClient
): Promise<AdminUserPrincipal> {
  assertAdminOrigin(req);
  return requireAdminUserAfterOrigin(req, supabase);
}

export async function requireOwnerUser(
  req: IncomingMessage,
  supabase: SupabaseClient
): Promise<AdminUserPrincipal> {
  assertAdminMutationOrigin(req);
  const principal = await requireAdminUserAfterOrigin(req, supabase);
  if (!isOwnerUserId(principal.userId)) {
    deny(req, {
      status: 403,
      code: "owner-required",
      message: "소유자 계정만 관리자 권한을 변경할 수 있습니다."
    });
  }
  return principal;
}

export function assertAdminMutationOrigin(req: IncomingMessage): void {
  assertAdminOrigin(req);
  if (!headerValue(req.headers.origin)) {
    deny(req, {
      status: 403,
      code: "forbidden-origin",
      message: "허용되지 않은 요청 출처입니다."
    });
  }
}

export function assertAdminOrigin(req: IncomingMessage): void {
  const fetchSite = headerValue(req.headers["sec-fetch-site"]);
  if (fetchSite === "cross-site") {
    deny(req, {
      status: 403,
      code: "forbidden-origin",
      message: "허용되지 않은 요청 출처입니다."
    });
  }

  const origin = headerValue(req.headers.origin);
  if (!origin) {
    return;
  }

  const normalized = normalizedOrigin(origin);
  if (!normalized || !allowedOrigins().has(normalized)) {
    deny(req, {
      status: 403,
      code: "forbidden-origin",
      message: "허용되지 않은 요청 출처입니다."
    });
  }
}

async function requireAdminUserAfterOrigin(
  req: IncomingMessage,
  supabase: SupabaseClient
): Promise<AdminUserPrincipal> {
  const token = bearerToken(req);
  if (!token) {
    deny(req, {
      status: 401,
      code: "admin-required",
      message: "관리자 로그인이 필요합니다."
    });
  }

  const userResult = await supabase.auth.getUser(token);
  const user = userResult.data.user;
  if (userResult.error || !user) {
    deny(req, {
      status: 401,
      code: "invalid-session",
      message: "로그인 세션을 확인할 수 없습니다."
    });
  }

  if (!isOwnerUserId(user.id)) {
    const profile = await supabase
      .from(profilesTable)
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (profile.error || profile.data?.role !== "admin") {
      deny(req, {
        status: 403,
        code: "admin-required",
        message: "관리자 계정만 사용할 수 있습니다."
      });
    }
  }

  return {
    kind: "user",
    userId: user.id,
    email: user.email || null
  };
}

function hasValidAutomationToken(req: IncomingMessage): boolean {
  if (headerValue(req.headers.origin) || headerValue(req.headers["sec-fetch-site"])) {
    return false;
  }

  const expected = process.env.BBBB_SHARED_ADMIN_TOKEN;
  const received = headerValue(req.headers["x-bbbb-admin-token"]);
  if (!expected || !received) {
    return false;
  }

  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

function allowedOrigins(): ReadonlySet<string> {
  const origins = new Set<string>(defaultSiteOrigins);
  for (const value of (process.env.BBBB_SITE_ORIGINS || "").split(",")) {
    const origin = normalizedOrigin(value.trim());
    if (origin) {
      origins.add(origin);
    }
  }

  const vercelUrl = process.env.VERCEL_URL;
  const previewOrigin = vercelUrl ? normalizedOrigin(`https://${vercelUrl}`) : null;
  if (previewOrigin) {
    origins.add(previewOrigin);
  }
  return origins;
}

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function bearerToken(req: IncomingMessage): string | undefined {
  const value = headerValue(req.headers.authorization);
  const match = value?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
}

function deny(req: IncomingMessage, denial: AdminDenial): never {
  console.warn(
    JSON.stringify({
      event: "admin.authorization",
      outcome: "denied",
      status: denial.status,
      reason: denial.code,
      method: req.method || null,
      path: new URL(req.url || "/", "https://bbbb.local").pathname,
      requestId: headerValue(req.headers["x-vercel-id"]) || null
    })
  );
  throw new AdminRequestError(denial);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
