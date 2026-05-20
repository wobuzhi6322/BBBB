import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { isOwnerEmail } from "./_owner.js";

type AdminDeviceBody = {
  deviceId?: unknown;
  licenseId?: unknown;
  email?: unknown;
  all?: unknown;
};

type SiteProfileRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string;
};

type LicenseRow = {
  id: string;
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
const profileSelect = "user_id,email,display_name,role";
const licenseSelect = "id,license_code,plan,status,max_devices,expires_at";
const deviceSelect = "id,license_id,user_id,device_fingerprint,device_name,app_version,last_seen_at,created_at";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!["GET", "DELETE"].includes(req.method || "")) {
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  try {
    const supabase = serviceClient();
    await assertAdmin(req, supabase);

    if (req.method === "GET") {
      await listUserDevices(req, res, supabase);
      return;
    }

    await deleteDevices(res, await readJson(req), supabase);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "admin-device-request-failed" });
  }
}

async function listUserDevices(req: IncomingMessage, res: ServerResponse, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const url = new URL(req.url || "/api/admin-devices", "https://bbbb.local");
  const email = url.searchParams.get("email") || undefined;
  const userId = url.searchParams.get("userId") || undefined;
  const profile = await resolveProfile({ email, userId }, supabase);
  const [licensesResult, devicesResult] = await Promise.all([
    supabase.from(licensesTable).select(licenseSelect).eq("user_id", profile.user_id).order("issued_at", { ascending: false }),
    supabase.from(devicesTable).select(deviceSelect).eq("user_id", profile.user_id).order("last_seen_at", { ascending: false })
  ]);
  assertNoError(licensesResult.error);
  assertNoError(devicesResult.error);

  const licenses = ((licensesResult.data || []) as LicenseRow[]).map(normalizeLicenseDeviceLimit);
  const devices = ((devicesResult.data || []) as DeviceRow[]).map((device) => ({
    ...publicDevice(device),
    license: licenses.find((license) => license.id === device.license_id) || null
  }));

  sendJson(res, 200, {
    ok: true,
    data: {
      profile,
      licenses,
      devices
    }
  });
}

async function deleteDevices(res: ServerResponse, body: AdminDeviceBody, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const deviceId = stringValue(body.deviceId);
  const licenseId = stringValue(body.licenseId);
  const email = stringValue(body.email);
  const deleteAll = body.all === true;

  let query = supabase.from(devicesTable).delete();

  if (deviceId) {
    query = query.eq("id", deviceId);
  } else if (deleteAll && licenseId) {
    query = query.eq("license_id", licenseId);
  } else if (deleteAll && email) {
    const profile = await resolveProfile({ email }, supabase);
    query = query.eq("user_id", profile.user_id);
  } else {
    throw new Error("삭제할 PC를 선택해 주세요.");
  }

  const result = await query.select("id");
  assertNoError(result.error);
  sendJson(res, 200, {
    ok: true,
    data: {
      deletedCount: result.data?.length || 0
    }
  });
}

async function resolveProfile(body: { email?: unknown; userId?: unknown }, supabase: ReturnType<typeof serviceClient>): Promise<SiteProfileRow> {
  const userId = stringValue(body.userId);
  if (userId) {
    const profile = await supabase.from(profilesTable).select(profileSelect).eq("user_id", userId).single();
    if (profile.error || !profile.data?.user_id) {
      throw new Error("해당 사용자 계정을 찾을 수 없습니다.");
    }
    return profile.data as SiteProfileRow;
  }

  const email = stringValue(body.email)?.toLowerCase();
  if (!email) {
    throw new Error("사용자 이메일이 필요합니다.");
  }

  const profile = await supabase.from(profilesTable).select(profileSelect).ilike("email", email).single();
  if (profile.error || !profile.data?.user_id) {
    throw new Error("해당 이메일의 가입 계정을 찾을 수 없습니다.");
  }
  return profile.data as SiteProfileRow;
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
  if (isOwnerEmail(user.email || null)) {
    return;
  }

  const profile = await supabase.from(profilesTable).select("role").eq("user_id", user.id).single();
  if (profile.error || profile.data?.role !== "admin") {
    throw new Error("관리자 계정만 PC 등록을 해제할 수 있습니다.");
  }
}

function publicDevice(device: DeviceRow) {
  return {
    id: device.id,
    licenseId: device.license_id,
    deviceName: device.device_name,
    appVersion: device.app_version,
    fingerprintSuffix: device.device_fingerprint.slice(-8).toUpperCase(),
    lastSeenAt: device.last_seen_at,
    createdAt: device.created_at
  };
}

function normalizeLicenseDeviceLimit(license: LicenseRow): LicenseRow {
  return { ...license, max_devices: 1 };
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

async function readJson(req: IncomingMessage): Promise<AdminDeviceBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as AdminDeviceBody;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function assertNoError(error: { message: string } | null | undefined): void {
  if (error) {
    throw new Error(error.message);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,DELETE,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-bbbb-admin-token"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization,content-type,x-bbbb-admin-token");
}
