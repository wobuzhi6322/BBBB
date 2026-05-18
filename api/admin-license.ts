import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

type AdminLicenseBody = {
  email?: unknown;
  userId?: unknown;
  plan?: unknown;
  status?: unknown;
  expiresAt?: unknown;
  notes?: unknown;
};

type PlanLimits = {
  maxSignatures: number;
  maxMediaMb: number;
  maxDevices: number;
  sharedSyncEnabled: boolean;
};

const profilesTable = "bbbb_site_profiles";
const licensesTable = "bbbb_account_licenses";

const planLimits: Record<string, PlanLimits> = {
  starter: {
    maxSignatures: 3,
    maxMediaMb: 50,
    maxDevices: 1,
    sharedSyncEnabled: false
  },
  standard: {
    maxSignatures: 10,
    maxMediaMb: 300,
    maxDevices: 1,
    sharedSyncEnabled: false
  },
  pro: {
    maxSignatures: 50,
    maxMediaMb: 1024,
    maxDevices: 3,
    sharedSyncEnabled: true
  }
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  try {
    const supabase = serviceClient();
    await assertAdmin(req, supabase);
    const body = await readJson(req);
    const userId = await resolveUserId(body, supabase);
    const plan = normalizePlan(body.plan);
    const status = normalizeStatus(body.status);
    const limits = planLimits[plan];
    const now = new Date().toISOString();
    const licenseCode = createLicenseCode();

    const insert = await supabase
      .from(licensesTable)
      .insert({
        user_id: userId,
        license_code: licenseCode,
        plan,
        status,
        max_signatures: limits.maxSignatures,
        max_media_mb: limits.maxMediaMb,
        max_devices: limits.maxDevices,
        shared_sync_enabled: limits.sharedSyncEnabled,
        notes: stringValue(body.notes)?.slice(0, 1000) || null,
        activated_at: status === "active" ? now : null,
        expires_at: dateValue(body.expiresAt),
        updated_at: now
      })
      .select("id,user_id,license_code,plan,status,max_signatures,max_media_mb,max_devices,shared_sync_enabled,issued_at,activated_at,expires_at")
      .single();

    if (insert.error) {
      throw new Error(insert.error.message);
    }

    sendJson(res, 200, { ok: true, data: { license: insert.data } });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "license-create-failed" });
  }
}

async function resolveUserId(body: AdminLicenseBody, supabase: ReturnType<typeof serviceClient>): Promise<string> {
  const userId = stringValue(body.userId);
  if (userId) {
    return userId;
  }

  const email = stringValue(body.email)?.toLowerCase();
  if (!email) {
    throw new Error("email 또는 userId가 필요합니다.");
  }

  const profile = await supabase.from(profilesTable).select("user_id").eq("email", email).single();
  if (profile.error || !profile.data?.user_id) {
    throw new Error("해당 이메일의 가입 계정을 찾을 수 없습니다. 사용자가 먼저 회원가입해야 합니다.");
  }
  return String(profile.data.user_id);
}

function normalizePlan(value: unknown): string {
  const plan = stringValue(value)?.toLowerCase() || "starter";
  if (!planLimits[plan]) {
    throw new Error("plan은 starter, standard, pro 중 하나여야 합니다.");
  }
  return plan;
}

function normalizeStatus(value: unknown): string {
  const status = stringValue(value)?.toLowerCase() || "active";
  if (!["pending", "active", "expired", "suspended"].includes(status)) {
    throw new Error("status는 pending, active, expired, suspended 중 하나여야 합니다.");
  }
  return status;
}

function createLicenseCode(): string {
  const raw = randomBytes(12).toString("hex").toUpperCase();
  return `GD-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function dateValue(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error("expiresAt 날짜 형식이 올바르지 않습니다.");
  }
  return date.toISOString();
}

async function assertAdmin(req: IncomingMessage, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const expected = process.env.BBBB_SHARED_ADMIN_TOKEN;
  const received = req.headers["x-bbbb-admin-token"];
  const token = Array.isArray(received) ? received[0] : received;
  if (expected && token === expected) {
    return;
  }

  const sessionToken = bearerToken(req);
  if (!sessionToken) {
    throw new Error("관리자 권한이 필요합니다.");
  }

  const userResult = await supabase.auth.getUser(sessionToken);
  const user = userResult.data.user;
  if (userResult.error || !user) {
    throw new Error("로그인 세션을 확인할 수 없습니다.");
  }

  const profile = await supabase.from(profilesTable).select("role").eq("user_id", user.id).single();
  if (profile.error || profile.data?.role !== "admin") {
    throw new Error("관리자 계정만 라이선스를 발급할 수 있습니다.");
  }
}

function bearerToken(req: IncomingMessage): string | undefined {
  const value = headerValue(req.headers.authorization);
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function readJson(req: IncomingMessage): Promise<AdminLicenseBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as AdminLicenseBody;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-bbbb-admin-token"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization,content-type,x-bbbb-admin-token");
}
