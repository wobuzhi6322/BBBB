import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

type RedeemBody = {
  code?: unknown;
};

type LicenseCodeRow = {
  id: string;
  code_prefix: string;
  plan: string;
  duration_hours: number | null;
  max_redemptions: number;
  redeemed_count: number;
  valid_until: string | null;
  is_active: boolean;
};

type LicenseRow = {
  id: string;
  license_code: string;
  plan: string;
  status: string;
  expires_at: string | null;
  activated_at: string | null;
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
const licensesTable = "bbbb_account_licenses";
const codeSelect = "id,code_prefix,plan,duration_hours,max_redemptions,redeemed_count,valid_until,is_active";
const licenseSelect = "id,license_code,plan,status,expires_at,activated_at";

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
    maxDevices: 1,
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
    const user = await requireUser(req, supabase);
    await ensureProfile(user.id, user.email || null, supabase);
    const body = await readJson(req);
    const code = stringValue(body.code);
    if (!code) {
      throw new Error("등록할 코드를 입력해 주세요.");
    }

    const licenseCode = await getRedeemableCode(code, supabase);
    if (isGuestLicenseCode(licenseCode)) {
      throw new Error("비회원용 코드는 프로그램 로그인 화면의 비회원 코드로 등록하세요.");
    }
    const previousRedemption = await supabase
      .from(redemptionsTable)
      .select("id")
      .eq("code_id", licenseCode.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (previousRedemption.error) {
      throw new Error(previousRedemption.error.message);
    }
    if (previousRedemption.data) {
      throw new Error("이미 이 계정에서 등록한 코드입니다.");
    }

    const license = await applyLicenseCode(user.id, licenseCode, supabase);
    const redemption = await supabase
      .from(redemptionsTable)
      .insert({
        code_id: licenseCode.id,
        user_id: user.id,
        license_id: license.id
      })
      .select("id")
      .single();
    if (redemption.error) {
      throw new Error(redemption.error.message);
    }

    const updateCode = await supabase
      .from(licenseCodesTable)
      .update({
        redeemed_count: licenseCode.redeemed_count + 1,
        updated_at: new Date().toISOString()
      })
      .eq("id", licenseCode.id);
    if (updateCode.error) {
      throw new Error(updateCode.error.message);
    }

    sendJson(res, 200, {
      ok: true,
      data: {
        license,
        code: {
          codePrefix: licenseCode.code_prefix,
          plan: licenseCode.plan,
          durationHours: licenseCode.duration_hours
        }
      }
    });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "license-code-redeem-failed" });
  }
}

async function getRedeemableCode(code: string, supabase: ReturnType<typeof serviceClient>): Promise<LicenseCodeRow> {
  const result = await supabase.from(licenseCodesTable).select(codeSelect).eq("code_hash", hashCode(code)).single();
  if (result.error || !result.data) {
    throw new Error("코드를 찾을 수 없습니다.");
  }

  const licenseCode = result.data as LicenseCodeRow;
  if (!licenseCode.is_active) {
    throw new Error("비활성화된 코드입니다.");
  }
  if (licenseCode.valid_until && new Date(licenseCode.valid_until).getTime() < Date.now()) {
    throw new Error("만료된 코드입니다.");
  }
  if (licenseCode.redeemed_count >= licenseCode.max_redemptions) {
    throw new Error("사용 가능 횟수를 초과한 코드입니다.");
  }
  if (!planLimits[licenseCode.plan]) {
    throw new Error("코드 플랜 정보가 올바르지 않습니다.");
  }
  return licenseCode;
}

function isGuestLicenseCode(code: LicenseCodeRow): boolean {
  return code.code_prefix.toUpperCase().startsWith("GD-GST");
}

async function applyLicenseCode(userId: string, code: LicenseCodeRow, supabase: ReturnType<typeof serviceClient>): Promise<LicenseRow> {
  const existing = await supabase
    .from(licensesTable)
    .select(licenseSelect)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.error) {
    throw new Error(existing.error.message);
  }

  const limits = planLimits[code.plan];
  const now = new Date();
  const expiresAt =
    existing.data && existing.data.expires_at === null ? null : calculateExpiresAt(code.duration_hours, existing.data?.expires_at || null, now);

  if (existing.data) {
    const updated = await supabase
      .from(licensesTable)
      .update({
        plan: code.plan,
        status: "active",
        max_signatures: limits.maxSignatures,
        max_media_mb: limits.maxMediaMb,
        max_devices: limits.maxDevices,
        shared_sync_enabled: limits.sharedSyncEnabled,
        expires_at: expiresAt,
        updated_at: now.toISOString()
      })
      .eq("id", existing.data.id)
      .select(licenseSelect)
      .single();
    if (updated.error) {
      throw new Error(updated.error.message);
    }
    return updated.data as LicenseRow;
  }

  const inserted = await supabase
    .from(licensesTable)
    .insert({
      user_id: userId,
      license_code: createLicenseCode(),
      plan: code.plan,
      status: "active",
      max_signatures: limits.maxSignatures,
      max_media_mb: limits.maxMediaMb,
      max_devices: limits.maxDevices,
      shared_sync_enabled: limits.sharedSyncEnabled,
      notes: `redeemed ${code.code_prefix}`,
      activated_at: now.toISOString(),
      expires_at: expiresAt,
      updated_at: now.toISOString()
    })
    .select(licenseSelect)
    .single();
  if (inserted.error) {
    throw new Error(inserted.error.message);
  }
  return inserted.data as LicenseRow;
}

function calculateExpiresAt(durationHours: number | null, currentExpiresAt: string | null, now: Date): string | null {
  if (durationHours === null) {
    return null;
  }
  const current = currentExpiresAt ? new Date(currentExpiresAt) : null;
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + durationHours * 60 * 60 * 1000).toISOString();
}

function createLicenseCode(): string {
  const raw = randomBytes(12).toString("hex").toUpperCase();
  return `LC-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}`;
}

function hashCode(code: string): string {
  return createHash("sha256").update(normalizeCode(code)).digest("hex");
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

async function requireUser(req: IncomingMessage, supabase: ReturnType<typeof serviceClient>) {
  const token = bearerToken(req);
  if (!token) {
    throw new Error("로그인이 필요합니다.");
  }
  const result = await supabase.auth.getUser(token);
  if (result.error || !result.data.user) {
    throw new Error("로그인 세션을 확인할 수 없습니다.");
  }
  return result.data.user;
}

async function ensureProfile(userId: string, email: string | null, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const result = await supabase.from(profilesTable).upsert(
    {
      user_id: userId,
      email,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (result.error) {
    throw new Error(result.error.message);
  }
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

async function readJson(req: IncomingMessage): Promise<RedeemBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as RedeemBody;
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
    "access-control-allow-headers": "authorization,content-type"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization,content-type");
}
