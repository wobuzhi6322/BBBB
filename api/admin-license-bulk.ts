import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { isOwnerEmail } from "./_owner.js";

type BulkAction = "move-folder" | "update-licenses";

type BulkLicensePatch = {
  readonly plan?: unknown;
  readonly status?: unknown;
  readonly maxSignatures?: unknown;
  readonly maxMediaMb?: unknown;
  readonly expiresAt?: unknown;
  readonly sharedSyncEnabled?: unknown;
};

type BulkBody = {
  readonly action?: unknown;
  readonly userIds?: unknown;
  readonly category?: unknown;
  readonly license?: BulkLicensePatch;
};

type PlanLimits = {
  readonly maxSignatures: number;
  readonly maxMediaMb: number;
  readonly maxDevices: number;
  readonly sharedSyncEnabled: boolean;
};

type SiteProfileRow = {
  readonly user_id: string;
  readonly display_name: string | null;
};

type LicenseRow = {
  readonly id: string;
  readonly user_id: string;
  readonly plan: string;
  readonly status: string;
  readonly max_signatures: number;
  readonly max_media_mb: number;
  readonly max_devices: number;
  readonly shared_sync_enabled: boolean;
  readonly issued_at: string;
  readonly activated_at: string | null;
  readonly expires_at: string | null;
};

type ParsedProfileName = {
  readonly name: string;
  readonly category: string;
  readonly notes: string;
};

const profilesTable = "bbbb_site_profiles";
const licensesTable = "bbbb_account_licenses";
const licenseSelect =
  "id,user_id,plan,status,max_signatures,max_media_mb,max_devices,shared_sync_enabled,issued_at,activated_at,expires_at";
const maxBulkUsers = 500;
const maxManualLimit = 1_000_000;

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
    await assertAdmin(req, supabase);

    const body = await readJson(req);
    const action = normalizeAction(body.action);
    const userIds = normalizeUserIds(body.userIds);

    if (action === "move-folder") {
      await moveFolderUsers(res, supabase, userIds, normalizeCategory(body.category));
      return;
    }

    await updateFolderLicenses(res, supabase, userIds, body.license || {});
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "admin-license-bulk-failed" });
  }
}

async function moveFolderUsers(
  res: ServerResponse,
  supabase: ReturnType<typeof serviceClient>,
  userIds: readonly string[],
  category: string
): Promise<void> {
  const { data, error } = await supabase
    .from(profilesTable)
    .select("user_id,display_name")
    .in("user_id", userIds);

  if (error) {
    throw new Error(error.message);
  }

  let updatedProfiles = 0;
  const errors: string[] = [];

  for (const profile of (data || []) as SiteProfileRow[]) {
    const parsed = parseProfileName(profile.display_name);
    const displayName = JSON.stringify({
      name: parsed.name,
      category,
      notes: parsed.notes
    });
    const update = await supabase
      .from(profilesTable)
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq("user_id", profile.user_id);

    if (update.error) {
      errors.push(`${profile.user_id}: ${update.error.message}`);
    } else {
      updatedProfiles += 1;
    }
  }

  sendJson(res, 200, {
    ok: true,
    data: {
      updatedProfiles,
      skippedProfiles: userIds.length - ((data || []) as SiteProfileRow[]).length,
      errors
    }
  });
}

async function updateFolderLicenses(
  res: ServerResponse,
  supabase: ReturnType<typeof serviceClient>,
  userIds: readonly string[],
  licensePatch: BulkLicensePatch
): Promise<void> {
  const patch = normalizeLicensePatch(licensePatch);
  if (Object.keys(patch).length === 0) {
    throw new Error("변경할 라이선스 값이 없습니다.");
  }

  let updatedLicenses = 0;
  let skippedNoLicense = 0;
  const errors: string[] = [];

  for (const userId of userIds) {
    const license = await findTargetLicense(supabase, userId);
    if (!license) {
      skippedNoLicense += 1;
      continue;
    }

    const payload = buildLicenseUpdatePayload(license, patch);
    const { error } = await supabase.from(licensesTable).update(payload).eq("id", license.id);
    if (error) {
      errors.push(`${userId}: ${error.message}`);
    } else {
      updatedLicenses += 1;
    }
  }

  sendJson(res, 200, {
    ok: true,
    data: {
      updatedLicenses,
      skippedNoLicense,
      errors
    }
  });
}

async function findTargetLicense(supabase: ReturnType<typeof serviceClient>, userId: string): Promise<LicenseRow | null> {
  const { data, error } = await supabase
    .from(licensesTable)
    .select(licenseSelect)
    .eq("user_id", userId)
    .order("issued_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(error.message);
  }

  const licenses = (data || []) as LicenseRow[];
  return licenses.find((license) => license.status === "active") || licenses[0] || null;
}

function buildLicenseUpdatePayload(license: LicenseRow, patch: Record<string, string | number | boolean>): Record<string, unknown> {
  const plan = typeof patch.plan === "string" ? patch.plan : license.plan;
  const planChanged = plan !== license.plan;
  const defaults = planLimits[plan] || planLimits.starter;
  const status = typeof patch.status === "string" ? patch.status : license.status;
  const now = new Date().toISOString();
  const payload: Record<string, unknown> = { updated_at: now };

  if (typeof patch.plan === "string") {
    payload.plan = patch.plan;
    payload.max_signatures = defaults.maxSignatures;
    payload.max_media_mb = defaults.maxMediaMb;
    payload.max_devices = defaults.maxDevices;
    payload.shared_sync_enabled = defaults.sharedSyncEnabled;
  }
  if (typeof patch.status === "string") {
    payload.status = patch.status;
    payload.activated_at = status === "active" ? license.activated_at || now : license.activated_at;
  }
  if (typeof patch.maxSignatures === "number") {
    payload.max_signatures = patch.maxSignatures;
  }
  if (typeof patch.maxMediaMb === "number") {
    payload.max_media_mb = patch.maxMediaMb;
  }
  if (typeof patch.expiresAt === "string") {
    payload.expires_at = patch.expiresAt;
  }
  if (typeof patch.sharedSyncEnabled === "boolean") {
    payload.shared_sync_enabled = patch.sharedSyncEnabled;
  } else if (planChanged) {
    payload.shared_sync_enabled = defaults.sharedSyncEnabled;
  }

  return payload;
}

function normalizeLicensePatch(input: BulkLicensePatch): Record<string, string | number | boolean> {
  const patch: Record<string, string | number | boolean> = {};
  if ("plan" in input && input.plan !== undefined && input.plan !== "") {
    patch.plan = normalizePlan(input.plan);
  }
  if ("status" in input && input.status !== undefined && input.status !== "") {
    patch.status = normalizeStatus(input.status);
  }
  if ("maxSignatures" in input && input.maxSignatures !== undefined && input.maxSignatures !== "") {
    patch.maxSignatures = nonNegativeIntegerValue(input.maxSignatures, "시그니처 제한");
  }
  if ("maxMediaMb" in input && input.maxMediaMb !== undefined && input.maxMediaMb !== "") {
    patch.maxMediaMb = nonNegativeIntegerValue(input.maxMediaMb, "미디어 용량");
  }
  if ("expiresAt" in input && input.expiresAt !== undefined && input.expiresAt !== "") {
    patch.expiresAt = dateValue(input.expiresAt);
  }
  if ("sharedSyncEnabled" in input && input.sharedSyncEnabled !== undefined && input.sharedSyncEnabled !== "") {
    patch.sharedSyncEnabled = booleanValue(input.sharedSyncEnabled);
  }
  return patch;
}

function parseProfileName(displayName: string | null): ParsedProfileName {
  if (!displayName) {
    return { name: "", category: "분류 없음", notes: "" };
  }

  try {
    const parsed = JSON.parse(displayName) as unknown;
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      return {
        name: typeof record.name === "string" ? record.name : "",
        category: typeof record.category === "string" && record.category.trim() ? record.category.trim() : "분류 없음",
        notes: typeof record.notes === "string" ? record.notes : ""
      };
    }
  } catch {
    return { name: displayName, category: "분류 없음", notes: "" };
  }

  return { name: displayName, category: "분류 없음", notes: "" };
}

function normalizeAction(value: unknown): BulkAction {
  if (value === "move-folder" || value === "update-licenses") {
    return value;
  }
  throw new Error("지원하지 않는 일괄 작업입니다.");
}

function normalizeUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new Error("선택 회원 목록이 필요합니다.");
  }
  const ids = Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
  if (ids.length === 0) {
    throw new Error("선택 회원이 없습니다.");
  }
  if (ids.length > maxBulkUsers) {
    throw new Error(`한 번에 ${maxBulkUsers}명까지만 처리할 수 있습니다.`);
  }
  return ids;
}

function normalizeCategory(value: unknown): string {
  const category = stringValue(value) || "분류 없음";
  return category.slice(0, 80);
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
  if (!["pending", "inactive", "active", "expired", "suspended"].includes(status)) {
    throw new Error("status는 pending, inactive, active, expired, suspended 중 하나여야 합니다.");
  }
  return status;
}

function nonNegativeIntegerValue(value: unknown, label: string): number {
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(number) || number < 0 || number > maxManualLimit) {
    throw new Error(`${label}은 0 이상 ${maxManualLimit.toLocaleString("ko-KR")} 이하의 정수여야 합니다.`);
  }
  return number;
}

function dateValue(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) {
    throw new Error("만료일 값이 비어 있습니다.");
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error("만료일 형식이 올바르지 않습니다.");
  }
  return date.toISOString();
}

function booleanValue(value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error("공유 동기화 값은 true 또는 false여야 합니다.");
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
    throw new Error("관리자 계정만 사용할 수 있습니다.");
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

async function readJson(req: IncomingMessage): Promise<BulkBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as BulkBody;
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
