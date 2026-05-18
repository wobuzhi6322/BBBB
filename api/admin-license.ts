import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

type AdminLicenseBody = {
  email?: unknown;
  userId?: unknown;
  licenseId?: unknown;
  licenseCode?: unknown;
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

type SiteProfileRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string;
};

type LicenseRow = {
  id: string;
  user_id: string;
  license_code: string;
  plan: string;
  status: string;
  max_signatures: number;
  max_media_mb: number;
  max_devices: number;
  shared_sync_enabled: boolean;
  issued_at: string;
  activated_at: string | null;
  expires_at: string | null;
  notes: string | null;
};

const profilesTable = "bbbb_site_profiles";
const licensesTable = "bbbb_account_licenses";
const licenseSelect =
  "id,user_id,license_code,plan,status,max_signatures,max_media_mb,max_devices,shared_sync_enabled,issued_at,activated_at,expires_at,notes";

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

  if (!["GET", "POST", "PATCH"].includes(req.method || "")) {
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  try {
    const supabase = serviceClient();
    await assertAdmin(req, supabase);

    if (req.method === "GET") {
      await handleLookup(req, res, supabase);
      return;
    }

    const body = await readJson(req);

    if (req.method === "PATCH") {
      await handleUpdate(res, body, supabase);
      return;
    }

    await handleCreate(res, body, supabase);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "license-request-failed" });
  }
}

async function handleLookup(req: IncomingMessage, res: ServerResponse, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const url = new URL(req.url || "/api/admin-license", "https://bbbb.local");
  const email = url.searchParams.get("email") || undefined;
  const userId = url.searchParams.get("userId") || undefined;
  const profile = await resolveProfile({ email, userId }, supabase);
  const licenses = await getLicensesForUser(profile.user_id, supabase);
  sendJson(res, 200, {
    ok: true,
    data: {
      profile,
      activeLicense: licenses.find((license) => license.status === "active") || licenses[0] || null,
      licenses
    }
  });
}

async function handleCreate(res: ServerResponse, body: AdminLicenseBody, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const profile = await resolveProfile(body, supabase);
  const existingActive = await supabase
    .from(licensesTable)
    .select(licenseSelect)
    .eq("user_id", profile.user_id)
    .eq("status", "active")
    .order("issued_at", { ascending: false })
    .limit(1);

  if (existingActive.error) {
    throw new Error(existingActive.error.message);
  }
  if (existingActive.data?.[0]) {
    throw new Error("이미 활성 라이선스가 있습니다. 기존 라이선스 조회 후 수정해 주세요.");
  }

  const plan = normalizePlan(body.plan);
  const status = normalizeStatus(body.status);
  const limits = planLimits[plan];
  const now = new Date().toISOString();
  const licenseCode = createLicenseCode();

  const insert = await supabase
    .from(licensesTable)
    .insert({
      user_id: profile.user_id,
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
    .select(licenseSelect)
    .single();

  if (insert.error) {
    throw new Error(insert.error.message);
  }

  sendJson(res, 200, { ok: true, data: { license: insert.data } });
}

async function handleUpdate(res: ServerResponse, body: AdminLicenseBody, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const target = await resolveLicense(body, supabase);
  const plan = normalizePlan(body.plan || target.plan);
  const status = normalizeStatus(body.status || target.status);
  const limits = planLimits[plan];
  const now = new Date().toISOString();

  const update = await supabase
    .from(licensesTable)
    .update({
      plan,
      status,
      max_signatures: limits.maxSignatures,
      max_media_mb: limits.maxMediaMb,
      max_devices: limits.maxDevices,
      shared_sync_enabled: limits.sharedSyncEnabled,
      notes: stringValue(body.notes)?.slice(0, 1000) || null,
      activated_at: status === "active" ? target.activated_at || now : target.activated_at,
      expires_at: dateValue(body.expiresAt),
      updated_at: now
    })
    .eq("id", target.id)
    .select(licenseSelect)
    .single();

  if (update.error) {
    throw new Error(update.error.message);
  }

  sendJson(res, 200, { ok: true, data: { license: update.data } });
}

async function resolveLicense(body: AdminLicenseBody, supabase: ReturnType<typeof serviceClient>): Promise<LicenseRow> {
  const licenseId = stringValue(body.licenseId);
  const licenseCode = stringValue(body.licenseCode);
  let query = supabase.from(licensesTable).select(licenseSelect);

  if (licenseId) {
    query = query.eq("id", licenseId);
  } else if (licenseCode) {
    query = query.eq("license_code", licenseCode);
  } else {
    const profile = await resolveProfile(body, supabase);
    const licenses = await getLicensesForUser(profile.user_id, supabase);
    const target = licenses.find((license) => license.status === "active") || licenses[0];
    if (!target) {
      throw new Error("수정할 라이선스가 없습니다.");
    }
    return target;
  }

  const result = await query.single();
  if (result.error || !result.data) {
    throw new Error("수정할 라이선스를 찾을 수 없습니다.");
  }
  return result.data as LicenseRow;
}

async function getLicensesForUser(userId: string, supabase: ReturnType<typeof serviceClient>): Promise<LicenseRow[]> {
  const result = await supabase.from(licensesTable).select(licenseSelect).eq("user_id", userId).order("issued_at", { ascending: false });
  if (result.error) {
    throw new Error(result.error.message);
  }
  return (result.data || []) as LicenseRow[];
}

async function resolveProfile(body: Pick<AdminLicenseBody, "email" | "userId">, supabase: ReturnType<typeof serviceClient>): Promise<SiteProfileRow> {
  const userId = stringValue(body.userId);
  if (userId) {
    const profile = await supabase.from(profilesTable).select("user_id,email,display_name,role").eq("user_id", userId).single();
    if (profile.error || !profile.data?.user_id) {
      throw new Error("해당 사용자 계정을 찾을 수 없습니다.");
    }
    return profile.data as SiteProfileRow;
  }

  const email = stringValue(body.email)?.toLowerCase();
  if (!email) {
    throw new Error("email 또는 userId가 필요합니다.");
  }

  const profile = await supabase.from(profilesTable).select("user_id,email,display_name,role").ilike("email", email).single();
  if (profile.error || !profile.data?.user_id) {
    throw new Error("해당 이메일의 가입 계정을 찾을 수 없습니다. 사용자가 먼저 회원가입해야 합니다.");
  }
  return profile.data as SiteProfileRow;
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
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-bbbb-admin-token"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization,content-type,x-bbbb-admin-token");
}
