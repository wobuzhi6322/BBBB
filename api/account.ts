import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { isOwnerEmail, ownerLicense } from "./_owner.js";

type SiteProfileRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  created_at: string;
  updated_at: string;
};

type LicenseRow = {
  id: string;
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
  updated_at: string;
};

type DeviceRow = {
  id: string;
  license_id: string;
  device_name: string | null;
  app_version: string | null;
  last_seen_at: string;
  created_at: string;
};

type SharedCodeRow = {
  code: string;
  role: string;
  created_at: string;
};

type DownloadEventRow = {
  release_tag: string;
  asset_name: string;
  created_at: string;
};

const profilesTable = "bbbb_site_profiles";
const licensesTable = "bbbb_account_licenses";
const devicesTable = "bbbb_account_devices";
const sharedCodesTable = "bbbb_shared_code_members";
const downloadsTable = "bbbb_download_events";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  try {
    const supabase = serviceClient();
    const token = bearerToken(req);
    if (!token) {
      sendJson(res, 401, { ok: false, error: "login-required" });
      return;
    }

    const userResult = await supabase.auth.getUser(token);
    const user = userResult.data.user;
    if (userResult.error || !user) {
      sendJson(res, 401, { ok: false, error: "invalid-session" });
      return;
    }

    await ensureProfile(user.id, user.email || null);

    const [profileResult, licensesResult, devicesResult, sharedCodesResult, downloadsResult] = await Promise.all([
      supabase.from(profilesTable).select("user_id,email,display_name,role,created_at,updated_at").eq("user_id", user.id).single(),
      supabase
        .from(licensesTable)
        .select("id,license_code,plan,status,max_signatures,max_media_mb,max_devices,shared_sync_enabled,issued_at,activated_at,expires_at,updated_at")
        .eq("user_id", user.id)
        .order("issued_at", { ascending: false }),
      supabase
        .from(devicesTable)
        .select("id,license_id,device_name,app_version,last_seen_at,created_at")
        .eq("user_id", user.id)
        .order("last_seen_at", { ascending: false }),
      supabase.from(sharedCodesTable).select("code,role,created_at").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase
        .from(downloadsTable)
        .select("release_tag,asset_name,created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(5)
    ]);

    assertNoError(profileResult.error);
    assertNoError(licensesResult.error);
    assertNoError(devicesResult.error);
    assertNoError(sharedCodesResult.error);
    assertNoError(downloadsResult.error);

    const profile = profileResult.data as SiteProfileRow;
    const ownerAccount = isOwnerEmail(user.email || profile.email);
    const licenses = ownerAccount ? ((licensesResult.data || []) as LicenseRow[]) : ((licensesResult.data || []) as LicenseRow[]).map(normalizeLicenseDeviceLimit);
    const ownerActiveLicense = ownerAccount ? (ownerLicense(user.id) as LicenseRow) : null;
    const activeLicense = ownerActiveLicense || licenses.find(isUsableLicense) || licenses[0] || null;

    sendJson(res, 200, {
      ok: true,
      data: {
        profile: ownerAccount ? { ...profile, role: "admin" } : profile,
        activeLicense,
        licenses: ownerActiveLicense ? [ownerActiveLicense, ...licenses] : licenses,
        devices: (devicesResult.data || []) as DeviceRow[],
        sharedCodes: (sharedCodesResult.data || []) as SharedCodeRow[],
        downloads: (downloadsResult.data || []) as DownloadEventRow[]
      }
    });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "account-load-failed" });
  }
}

function isUsableLicense(license: LicenseRow): boolean {
  return license.status === "active" && (!license.expires_at || new Date(license.expires_at).getTime() > Date.now());
}

function normalizeLicenseDeviceLimit(license: LicenseRow): LicenseRow {
  return { ...license, max_devices: 1 };
}

async function ensureProfile(userId: string, email: string | null): Promise<void> {
  const result = await serviceClient().from(profilesTable).upsert(
    {
      user_id: userId,
      email,
      ...(isOwnerEmail(email) ? { role: "admin" } : {}),
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  assertNoError(result.error);
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
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "authorization,content-type"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization,content-type");
}
