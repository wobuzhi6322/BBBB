import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

type GuestRedeemBody = {
  code?: unknown;
  redeemedAt?: unknown;
  deviceFingerprint?: unknown;
  deviceName?: unknown;
  appVersion?: unknown;
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

type PlanLimits = {
  maxSignatures: number;
  maxMediaMb: number;
  maxDevices: number;
  sharedSyncEnabled: boolean;
};

const licenseCodesTable = "bbbb_license_codes";
const codeSelect = "id,code_prefix,plan,duration_hours,max_redemptions,redeemed_count,valid_until,is_active";

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
    const body = await readJson(req);
    const code = stringValue(body.code);
    if (!code) {
      throw new Error("비회원 이용권 코드를 입력해 주세요.");
    }

    const redeemedAt = dateString(body.redeemedAt);
    const licenseCode = await getRedeemableGuestCode(code, supabase, Boolean(redeemedAt));
    const now = new Date();
    const activatedAt = redeemedAt || now.toISOString();
    const expiresAt = calculateExpiresAt(licenseCode.duration_hours, activatedAt);
    const status = expiresAt && new Date(expiresAt).getTime() < now.getTime() ? "expired" : "active";
    const limits = planLimits[licenseCode.plan];

    if (!redeemedAt) {
      const updateCode = await supabase
        .from(licenseCodesTable)
        .update({
          redeemed_count: licenseCode.redeemed_count + 1,
          updated_at: now.toISOString()
        })
        .eq("id", licenseCode.id);
      if (updateCode.error) {
        throw new Error(updateCode.error.message);
      }
    }

    sendJson(res, 200, {
      ok: true,
      data: {
        license: {
          id: `guest-${licenseCode.id}`,
          license_code: licenseCode.code_prefix,
          code_prefix: licenseCode.code_prefix,
          plan: licenseCode.plan,
          status,
          activated_at: activatedAt,
          expires_at: expiresAt,
          max_signatures: limits.maxSignatures,
          max_media_mb: limits.maxMediaMb,
          max_devices: limits.maxDevices,
          shared_sync_enabled: limits.sharedSyncEnabled,
          device_name: stringValue(body.deviceName),
          device_fingerprint: stringValue(body.deviceFingerprint),
          app_version: stringValue(body.appVersion)
        },
        code: {
          mode: "guest",
          codePrefix: licenseCode.code_prefix,
          plan: licenseCode.plan,
          durationHours: licenseCode.duration_hours
        }
      }
    });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "guest-license-code-failed" });
  }
}

async function getRedeemableGuestCode(
  code: string,
  supabase: ReturnType<typeof serviceClient>,
  allowAlreadyRedeemed: boolean
): Promise<LicenseCodeRow> {
  const result = await supabase.from(licenseCodesTable).select(codeSelect).eq("code_hash", hashCode(code)).single();
  if (result.error || !result.data) {
    throw new Error("코드를 찾을 수 없습니다.");
  }

  const licenseCode = result.data as LicenseCodeRow;
  if (!isGuestLicenseCode(licenseCode)) {
    throw new Error("로그인용 코드입니다. 계정 로그인 후 코드 등록에 입력하세요.");
  }
  if (!licenseCode.is_active) {
    throw new Error("비활성화된 코드입니다.");
  }
  if (licenseCode.valid_until && new Date(licenseCode.valid_until).getTime() < Date.now()) {
    throw new Error("만료된 코드입니다.");
  }
  if (!allowAlreadyRedeemed && licenseCode.redeemed_count >= licenseCode.max_redemptions) {
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

function calculateExpiresAt(durationHours: number | null, activatedAt: string): string | null {
  if (durationHours === null) {
    return null;
  }
  const start = new Date(activatedAt);
  if (Number.isNaN(start.getTime())) {
    return new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();
  }
  return new Date(start.getTime() + durationHours * 60 * 60 * 1000).toISOString();
}

function hashCode(code: string): string {
  return createHash("sha256").update(normalizeCode(code)).digest("hex");
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
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

async function readJson(req: IncomingMessage): Promise<GuestRedeemBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as GuestRedeemBody;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function dateString(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) {
    return undefined;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}
