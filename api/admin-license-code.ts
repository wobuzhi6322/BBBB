import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

type AdminCodeBody = {
  plan?: unknown;
  durationUnit?: unknown;
  durationValue?: unknown;
  maxRedemptions?: unknown;
  validUntil?: unknown;
  notes?: unknown;
};

type PlanLimits = {
  maxSignatures: number;
  maxMediaMb: number;
  maxDevices: number;
  sharedSyncEnabled: boolean;
};

const profilesTable = "bbbb_site_profiles";
const licenseCodesTable = "bbbb_license_codes";
const redemptionsTable = "bbbb_license_code_redemptions";
const codeSelect =
  "id,code_prefix,plan,duration_hours,max_redemptions,redeemed_count,valid_until,is_active,notes,created_by,created_at,updated_at";

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

  if (!["GET", "POST"].includes(req.method || "")) {
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  try {
    const supabase = serviceClient();
    const adminUserId = await assertAdmin(req, supabase);
    if (req.method === "GET") {
      await listCodes(res, supabase);
      return;
    }
    await createCode(res, await readJson(req), adminUserId, supabase);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "license-code-request-failed" });
  }
}

async function listCodes(res: ServerResponse, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const codes = await supabase.from(licenseCodesTable).select(codeSelect).order("created_at", { ascending: false }).limit(20);
  if (codes.error) {
    throw new Error(codes.error.message);
  }

  const redemptions = await supabase
    .from(redemptionsTable)
    .select("code_id,user_id,redeemed_at")
    .order("redeemed_at", { ascending: false })
    .limit(50);
  if (redemptions.error) {
    throw new Error(redemptions.error.message);
  }

  sendJson(res, 200, { ok: true, data: { codes: codes.data || [], redemptions: redemptions.data || [] } });
}

async function createCode(
  res: ServerResponse,
  body: AdminCodeBody,
  adminUserId: string,
  supabase: ReturnType<typeof serviceClient>
): Promise<void> {
  const plan = normalizePlan(body.plan);
  const durationHours = normalizeDuration(body.durationUnit, body.durationValue);
  const maxRedemptions = integerValue(body.maxRedemptions, 1, 1000) || 1;
  const validUntil = dateValue(body.validUntil);
  const code = createPlainCode(plan);
  const codePrefix = code.split("-").slice(0, 3).join("-");
  const now = new Date().toISOString();
  const limits = planLimits[plan];

  const insert = await supabase
    .from(licenseCodesTable)
    .insert({
      code_hash: hashCode(code),
      code_prefix: codePrefix,
      plan,
      duration_hours: durationHours,
      max_redemptions: maxRedemptions,
      redeemed_count: 0,
      valid_until: validUntil,
      is_active: true,
      notes: stringValue(body.notes)?.slice(0, 1000) || null,
      created_by: adminUserId,
      updated_at: now
    })
    .select(codeSelect)
    .single();

  if (insert.error) {
    throw new Error(insert.error.message);
  }

  sendJson(res, 200, {
    ok: true,
    data: {
      code,
      codeInfo: insert.data,
      limits
    }
  });
}

function createPlainCode(plan: string): string {
  const planPrefix = plan.slice(0, 3).toUpperCase();
  const raw = randomBytes(9).toString("hex").toUpperCase();
  return `GD-${planPrefix}-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

function hashCode(code: string): string {
  return createHash("sha256").update(normalizeCode(code)).digest("hex");
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function normalizePlan(value: unknown): string {
  const plan = stringValue(value)?.toLowerCase() || "starter";
  if (!planLimits[plan]) {
    throw new Error("plan은 starter, standard, pro 중 하나여야 합니다.");
  }
  return plan;
}

function normalizeDuration(unitValue: unknown, amountValue: unknown): number | null {
  const unit = stringValue(unitValue)?.toLowerCase() || "day";
  if (unit === "unlimited") {
    return null;
  }
  if (!["hour", "day"].includes(unit)) {
    throw new Error("기간 단위는 hour, day, unlimited 중 하나여야 합니다.");
  }
  const amount = integerValue(amountValue, 1, 3650);
  if (!amount) {
    throw new Error("기간 값은 1 이상이어야 합니다.");
  }
  return unit === "hour" ? amount : amount * 24;
}

function integerValue(value: unknown, min: number, max: number): number | null {
  const raw = typeof value === "number" ? value : Number(stringValue(value));
  if (!Number.isInteger(raw) || raw < min || raw > max) {
    return null;
  }
  return raw;
}

function dateValue(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) {
    return null;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error("validUntil 날짜 형식이 올바르지 않습니다.");
  }
  return date.toISOString();
}

async function assertAdmin(req: IncomingMessage, supabase: ReturnType<typeof serviceClient>): Promise<string> {
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
    throw new Error("관리자 계정만 이용권 코드를 발급할 수 있습니다.");
  }
  return user.id;
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

function bearerToken(req: IncomingMessage): string | undefined {
  const value = headerValue(req.headers.authorization);
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

async function readJson(req: IncomingMessage): Promise<AdminCodeBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as AdminCodeBody;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization,content-type");
}
