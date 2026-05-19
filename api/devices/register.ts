import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { isOwnerEmail, ownerLicense } from "../_owner.js";

type RegisterDeviceBody = {
  deviceFingerprint?: unknown;
  deviceName?: unknown;
  appVersion?: unknown;
};

type LicenseRow = {
  id: string;
  user_id: string;
  license_code: string;
  plan: string;
  status: string;
  max_devices: number;
  expires_at: string | null;
};

type DeviceRow = {
  id: string;
  license_id: string;
  user_id: string;
  device_fingerprint: string;
  device_name: string | null;
  app_version: string | null;
  last_seen_at: string;
  created_at: string;
};

const profilesTable = "bbbb_site_profiles";
const licensesTable = "bbbb_account_licenses";
const devicesTable = "bbbb_account_devices";
const licenseSelect = "id,user_id,license_code,plan,status,max_devices,expires_at";
const deviceSelect = "id,license_id,user_id,device_fingerprint,device_name,app_version,last_seen_at,created_at";

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
    const deviceFingerprint = normalizeFingerprint(body.deviceFingerprint);
    const deviceName = stringValue(body.deviceName)?.slice(0, 120) || null;
    const appVersion = stringValue(body.appVersion)?.slice(0, 40) || null;
    const now = new Date().toISOString();
    if (isOwnerEmail(user.email || null)) {
      sendJson(res, 200, {
        ok: true,
        data: {
          registered: true,
          reason: "관리자 계정은 PC 등록 제한을 받지 않습니다.",
          license: ownerLicense(user.id) as LicenseRow,
          device: {
            id: `owner-${deviceFingerprint}`,
            license_id: `owner-${user.id}`,
            user_id: user.id,
            device_fingerprint: deviceFingerprint,
            device_name: deviceName,
            app_version: appVersion,
            last_seen_at: now,
            created_at: now
          } as DeviceRow
        }
      });
      return;
    }

    const license = await getActiveLicense(user.id, supabase);
    const devices = await getLicenseDevices(license.id, supabase);
    const existing = devices.find((device) => device.device_fingerprint === deviceFingerprint);

    if (existing) {
      const update = await supabase
        .from(devicesTable)
        .update({
          device_name: deviceName,
          app_version: appVersion,
          last_seen_at: now
        })
        .eq("id", existing.id)
        .select(deviceSelect)
        .single();
      if (update.error) {
        throw new Error(update.error.message);
      }
      sendJson(res, 200, {
        ok: true,
        data: {
          registered: true,
          reason: "현재 PC 등록이 확인되었습니다.",
          license,
          device: update.data
        }
      });
      return;
    }

    if (devices.length > 0) {
      sendJson(res, 409, {
        ok: false,
        error: "이미 다른 PC에서 사용 중입니다. 관리자에게 PC 등록 초기화를 요청하세요.",
        data: {
          registered: false,
          reason: "이미 다른 PC에서 사용 중입니다.",
          license,
          registeredDevices: devices.map(publicDevice)
        }
      });
      return;
    }

    const insert = await supabase
      .from(devicesTable)
      .insert({
        license_id: license.id,
        user_id: user.id,
        device_fingerprint: deviceFingerprint,
        device_name: deviceName,
        app_version: appVersion,
        last_seen_at: now
      })
      .select(deviceSelect)
      .single();
    if (insert.error) {
      throw new Error(insert.error.message);
    }

    sendJson(res, 200, {
      ok: true,
      data: {
        registered: true,
        reason: "현재 PC를 등록했습니다.",
        license,
        device: insert.data
      }
    });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "device-register-failed" });
  }
}

async function getActiveLicense(userId: string, supabase: ReturnType<typeof serviceClient>): Promise<LicenseRow> {
  const result = await supabase
    .from(licensesTable)
    .select(licenseSelect)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (result.error) {
    throw new Error(result.error.message);
  }
  if (!result.data) {
    throw new Error("활성 이용권이 없습니다. 이용권 코드를 먼저 등록하세요.");
  }
  const license = result.data as LicenseRow;
  if (license.expires_at && new Date(license.expires_at).getTime() < Date.now()) {
    throw new Error("이용권이 만료되었습니다.");
  }
  return license;
}

async function getLicenseDevices(licenseId: string, supabase: ReturnType<typeof serviceClient>): Promise<DeviceRow[]> {
  const result = await supabase.from(devicesTable).select(deviceSelect).eq("license_id", licenseId).order("last_seen_at", { ascending: false });
  if (result.error) {
    throw new Error(result.error.message);
  }
  return (result.data || []) as DeviceRow[];
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
      ...(isOwnerEmail(email) ? { role: "admin" } : {}),
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  if (result.error) {
    throw new Error(result.error.message);
  }
}

function publicDevice(device: DeviceRow) {
  return {
    id: device.id,
    deviceName: device.device_name,
    appVersion: device.app_version,
    lastSeenAt: device.last_seen_at,
    createdAt: device.created_at
  };
}

function normalizeFingerprint(value: unknown): string {
  const fingerprint = stringValue(value);
  if (!fingerprint || !/^gdv1_[a-f0-9]{64}$/i.test(fingerprint)) {
    throw new Error("PC 등록 정보가 올바르지 않습니다.");
  }
  return fingerprint.toLowerCase();
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

async function readJson(req: IncomingMessage): Promise<RegisterDeviceBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as RegisterDeviceBody;
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
