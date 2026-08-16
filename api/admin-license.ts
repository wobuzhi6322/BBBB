import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  normalizeFeatureFlags,
  normalizeFeatureFlagsWithNotes,
  notesWithFeatureFlags,
  stripFeatureFlagsFromNotes,
  type FeatureFlags
} from "./_feature-flags.js";
import { AdminRequestError, requireAdmin, type AdminPrincipal } from "./_admin-auth.js";
import { isOwnerUserId } from "./_owner.js";
import { profilePatchFromBody, profileSelect } from "./_profile.js";
import { readJsonObject, RequestBodyError } from "./_request-body.js";
import { isMissingFeatureFlagsColumn, withoutFeatureFlags } from "./_schema-fallback.js";

type AdminLicenseBody = {
  email?: unknown;
  userId?: unknown;
  licenseId?: unknown;
  licenseCode?: unknown;
  plan?: unknown;
  status?: unknown;
  expiresAt?: unknown;
  notes?: unknown;
  featureFlags?: unknown;
  sharedSyncEnabled?: unknown;
  maxSignatures?: unknown;
  maxMediaMb?: unknown;
  addSignatures?: unknown;
  addMediaMb?: unknown;
  addMaxSignatures?: unknown;
  addMaxMediaMb?: unknown;
  profileName?: unknown;
  profileCategory?: unknown;
  profileNotes?: unknown;
  channelPlatform?: unknown;
  channelName?: unknown;
  channelUrl?: unknown;
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
  role_version: number;
  channel_platform?: string | null;
  channel_name?: string | null;
  channel_url?: string | null;
  trial_started_at?: string | null;
  trial_license_id?: string | null;
};

type AdminProfileRow = SiteProfileRow & {
  readonly isOwner: boolean;
};

type AdminPermissions = {
  readonly canManageAdminRoles: boolean;
};

type AdminLookupContext = {
  readonly req: IncomingMessage;
  readonly res: ServerResponse;
  readonly supabase: ReturnType<typeof serviceClient>;
  readonly permissions: AdminPermissions;
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
  feature_flags?: FeatureFlags;
  issued_at: string;
  activated_at: string | null;
  expires_at: string | null;
  notes: string | null;
};

const profilesTable = "bbbb_site_profiles";
const licensesTable = "bbbb_account_licenses";
const adminProfileSelect = `${profileSelect},role_version`;
const licenseSelect =
  "id,user_id,license_code,plan,status,max_signatures,max_media_mb,max_devices,shared_sync_enabled,feature_flags,issued_at,activated_at,expires_at,notes";
const licenseSelectWithoutFeatures =
  "id,user_id,license_code,plan,status,max_signatures,max_media_mb,max_devices,shared_sync_enabled,issued_at,activated_at,expires_at,notes";
const profileListPageSize = 1000;

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

const maxManualLimit = 1_000_000;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    const principal = await requireAdmin(req, supabase);

    if (req.method === "GET") {
      await handleLookup({
        req,
        res,
        supabase,
        permissions: permissionsFor(principal)
      });
      return;
    }

    const body = await readJson(req);

    if (req.method === "PATCH") {
      await handleUpdate(res, body, supabase);
      return;
    }

    await handleCreate(res, body, supabase);
  } catch (error) {
    if (error instanceof AdminRequestError) {
      sendJson(res, error.status, { ok: false, error: error.message, code: error.code });
      return;
    }
    if (error instanceof RequestBodyError) {
      sendJson(res, error.status, { ok: false, error: error.message, code: error.code });
      return;
    }
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "license-request-failed" });
  }
}

async function handleLookup(context: AdminLookupContext): Promise<void> {
  const { req, res, supabase, permissions } = context;
  const url = new URL(req.url || "/api/admin-license", "https://bbbb.local");
  const email = url.searchParams.get("email") || undefined;
  const userId = url.searchParams.get("userId") || undefined;

  if (!email && !userId) {
    const profiles = await fetchAllProfiles(supabase);
    sendJson(res, 200, {
      ok: true,
      data: {
        profiles: profiles.map(profileForAdmin),
        permissions
      }
    });
    return;
  }

  const profile = await resolveProfile({ email, userId }, supabase);
  const licenses = await getLicensesForUser(profile.user_id, supabase);
  sendJson(res, 200, {
    ok: true,
    data: {
      profile: profileForAdmin(profile),
      activeLicense: licenses.find((license) => license.status === "active") || licenses[0] || null,
      licenses,
      permissions
    }
  });
}

async function fetchAllProfiles(supabase: ReturnType<typeof serviceClient>): Promise<SiteProfileRow[]> {
  const profiles: SiteProfileRow[] = [];
  let from = 0;

  while (true) {
    const to = from + profileListPageSize - 1;
    const { data, error } = await supabase
      .from(profilesTable)
      .select(adminProfileSelect)
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    const rows = (data || []) as SiteProfileRow[];
    profiles.push(...rows);

    if (rows.length < profileListPageSize) {
      break;
    }

    from += profileListPageSize;
  }

  return profiles;
}

function permissionsFor(principal: AdminPrincipal): AdminPermissions {
  return {
    canManageAdminRoles: principal.kind === "user" && isOwnerUserId(principal.userId)
  };
}

function profileForAdmin(profile: SiteProfileRow): AdminProfileRow {
  return {
    ...profile,
    isOwner: isOwnerUserId(profile.user_id)
  };
}

async function handleCreate(res: ServerResponse, body: AdminLicenseBody, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const profile = await resolveProfile(body, supabase);
  const existingActive = await getActiveLicensesForUser(profile.user_id, supabase);
  if (existingActive[0]) {
    throw new Error("이미 활성 라이선스가 있습니다. 기존 라이선스 조회 후 수정해 주세요.");
  }

  const plan = normalizePlan(body.plan);
  const status = normalizeStatus(body.status);
  const limits = resolveCreateLimits(plan, body);
  const featureFlags = normalizeFeatureFlags(body.featureFlags);
  const now = new Date().toISOString();
  const licenseCode = createLicenseCode();
  const notes = stringValue(body.notes)?.slice(0, 1000) || null;

  const profileName = typeof body.profileName === "string" ? body.profileName.trim() : undefined;
  const profileCategory = typeof body.profileCategory === "string" ? body.profileCategory.trim() : undefined;
  const profileNotes = typeof body.profileNotes === "string" ? body.profileNotes.trim() : undefined;
  const channelPlatform = typeof body.channelPlatform === "string" ? body.channelPlatform.trim() : undefined;
  const channelName = typeof body.channelName === "string" ? body.channelName.trim() : undefined;
  const channelUrl = typeof body.channelUrl === "string" ? body.channelUrl.trim() : undefined;

  if (
    profileName !== undefined ||
    profileCategory !== undefined ||
    profileNotes !== undefined ||
    channelPlatform !== undefined ||
    channelName !== undefined ||
    channelUrl !== undefined
  ) {
    let name = profileName !== undefined ? profileName : "";
    let category = profileCategory !== undefined ? profileCategory : "";
    let pnotes = profileNotes !== undefined ? profileNotes : "";

    if (profile.display_name) {
      try {
        const parsed = JSON.parse(profile.display_name);
        if (parsed && typeof parsed === "object") {
          if (profileName === undefined) name = parsed.name || "";
          if (profileCategory === undefined) category = parsed.category || "";
          if (profileNotes === undefined) pnotes = parsed.notes || "";
        }
      } catch (e) {
        if (profileName === undefined) name = profile.display_name;
      }
    }

    const formatted = JSON.stringify({ name, category, notes: pnotes });
    const updatePayload: Record<string, unknown> = { display_name: formatted };
    if (channelPlatform !== undefined || channelName !== undefined || channelUrl !== undefined) {
      Object.assign(updatePayload, profilePatchFromBody({ channelPlatform, channelName, channelUrl }));
    }
    await supabase.from(profilesTable).update(updatePayload).eq("user_id", profile.user_id);
  }

  const license = await insertLicense(
    {
      user_id: profile.user_id,
      license_code: licenseCode,
      plan,
      status,
      max_signatures: limits.maxSignatures,
      max_media_mb: limits.maxMediaMb,
      max_devices: limits.maxDevices,
      shared_sync_enabled: limits.sharedSyncEnabled,
      feature_flags: featureFlags,
      notes: notesWithFeatureFlags(notes, featureFlags),
      activated_at: status === "active" ? now : null,
      expires_at: dateValue(body.expiresAt),
      updated_at: now
    },
    supabase
  );

  sendJson(res, 200, { ok: true, data: { license } });
}

async function handleUpdate(res: ServerResponse, body: AdminLicenseBody, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const target = await resolveLicense(body, supabase);
  const plan = normalizePlan(body.plan || target.plan);
  const status = normalizeStatus(body.status || target.status);
  const limits = resolveUpdateLimits(target, plan, body);
  const featureFlags = "featureFlags" in body ? normalizeFeatureFlags(body.featureFlags) : normalizeFeatureFlags(target.feature_flags);
  const now = new Date().toISOString();
  const notes = stringValue(body.notes)?.slice(0, 1000) || null;

  const profileName = typeof body.profileName === "string" ? body.profileName.trim() : undefined;
  const profileCategory = typeof body.profileCategory === "string" ? body.profileCategory.trim() : undefined;
  const profileNotes = typeof body.profileNotes === "string" ? body.profileNotes.trim() : undefined;
  const channelPlatform = typeof body.channelPlatform === "string" ? body.channelPlatform.trim() : undefined;
  const channelName = typeof body.channelName === "string" ? body.channelName.trim() : undefined;
  const channelUrl = typeof body.channelUrl === "string" ? body.channelUrl.trim() : undefined;

  if (
    profileName !== undefined ||
    profileCategory !== undefined ||
    profileNotes !== undefined ||
    channelPlatform !== undefined ||
    channelName !== undefined ||
    channelUrl !== undefined
  ) {
    const { data: currentProfile } = await supabase
      .from(profilesTable)
      .select("display_name")
      .eq("user_id", target.user_id)
      .single();

    let name = profileName !== undefined ? profileName : "";
    let category = profileCategory !== undefined ? profileCategory : "";
    let pnotes = profileNotes !== undefined ? profileNotes : "";

    if (currentProfile?.display_name) {
      try {
        const parsed = JSON.parse(currentProfile.display_name);
        if (parsed && typeof parsed === "object") {
          if (profileName === undefined) name = parsed.name || "";
          if (profileCategory === undefined) category = parsed.category || "";
          if (profileNotes === undefined) pnotes = parsed.notes || "";
        }
      } catch (e) {
        if (profileName === undefined) name = currentProfile.display_name;
      }
    }

    const formatted = JSON.stringify({ name, category, notes: pnotes });
    const updatePayload: Record<string, unknown> = { display_name: formatted };
    if (channelPlatform !== undefined || channelName !== undefined || channelUrl !== undefined) {
      Object.assign(updatePayload, profilePatchFromBody({ channelPlatform, channelName, channelUrl }));
    }
    await supabase.from(profilesTable).update(updatePayload).eq("user_id", target.user_id);
  }

  const license = await updateLicense(
    target.id,
    {
      plan,
      status,
      max_signatures: limits.maxSignatures,
      max_media_mb: limits.maxMediaMb,
      max_devices: limits.maxDevices,
      shared_sync_enabled: limits.sharedSyncEnabled,
      feature_flags: featureFlags,
      notes: notesWithFeatureFlags(notes, featureFlags),
      activated_at: status === "active" ? target.activated_at || now : target.activated_at,
      expires_at: dateValue(body.expiresAt),
      updated_at: now
    },
    supabase
  );

  sendJson(res, 200, { ok: true, data: { license } });
}

async function resolveLicense(body: AdminLicenseBody, supabase: ReturnType<typeof serviceClient>): Promise<LicenseRow> {
  const licenseId = stringValue(body.licenseId);
  const licenseCode = stringValue(body.licenseCode);

  if (licenseId) {
    return selectSingleLicense((select) => supabase.from(licensesTable).select(select).eq("id", licenseId).single());
  } else if (licenseCode) {
    return selectSingleLicense((select) => supabase.from(licensesTable).select(select).eq("license_code", licenseCode).single());
  } else {
    const profile = await resolveProfile(body, supabase);
    const licenses = await getLicensesForUser(profile.user_id, supabase);
    const target = licenses.find((license) => license.status === "active") || licenses[0];
    if (!target) {
      throw new Error("수정할 라이선스가 없습니다.");
    }
    return target;
  }

  throw new Error("license-not-found");
}

async function getLicensesForUser(userId: string, supabase: ReturnType<typeof serviceClient>): Promise<LicenseRow[]> {
  let result: { data: unknown; error: { message: string } | null } = await supabase
    .from(licensesTable)
    .select(licenseSelect)
    .eq("user_id", userId)
    .order("issued_at", { ascending: false });
  if (isMissingFeatureFlagsColumn(result.error)) {
    result = await supabase.from(licensesTable).select(licenseSelectWithoutFeatures).eq("user_id", userId).order("issued_at", { ascending: false });
  }
  if (result.error) {
    throw new Error(result.error.message);
  }
  return ((result.data || []) as LicenseRow[]).map(normalizeLicenseDeviceLimit);
}

async function getActiveLicensesForUser(userId: string, supabase: ReturnType<typeof serviceClient>): Promise<LicenseRow[]> {
  let result: { data: unknown; error: { message: string } | null } = await supabase
    .from(licensesTable)
    .select(licenseSelect)
    .eq("user_id", userId)
    .eq("status", "active")
    .order("issued_at", { ascending: false })
    .limit(1);
  if (isMissingFeatureFlagsColumn(result.error)) {
    result = await supabase
      .from(licensesTable)
      .select(licenseSelectWithoutFeatures)
      .eq("user_id", userId)
      .eq("status", "active")
      .order("issued_at", { ascending: false })
      .limit(1);
  }
  if (result.error) {
    throw new Error(result.error.message);
  }
  return ((result.data || []) as LicenseRow[]).map(normalizeLicenseDeviceLimit);
}

async function selectSingleLicense(run: (select: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<LicenseRow> {
  let result = await run(licenseSelect);
  if (isMissingFeatureFlagsColumn(result.error)) {
    result = await run(licenseSelectWithoutFeatures);
  }
  if (result.error || !result.data) {
    throw new Error("license-not-found");
  }
  return normalizeLicenseDeviceLimit(result.data as LicenseRow);
}

async function insertLicense(payload: Record<string, unknown>, supabase: ReturnType<typeof serviceClient>): Promise<LicenseRow> {
  let result = await supabase.from(licensesTable).insert(payload).select(licenseSelect).single();
  if (isMissingFeatureFlagsColumn(result.error)) {
    result = await supabase.from(licensesTable).insert(withoutFeatureFlags(payload)).select(licenseSelectWithoutFeatures).single();
  }
  if (result.error || !result.data) {
    throw new Error(result.error?.message || "license-create-failed");
  }
  return normalizeLicenseDeviceLimit(result.data as LicenseRow);
}

async function updateLicense(
  licenseId: string,
  payload: Record<string, unknown>,
  supabase: ReturnType<typeof serviceClient>
): Promise<LicenseRow> {
  let result = await supabase.from(licensesTable).update(payload).eq("id", licenseId).select(licenseSelect).single();
  if (isMissingFeatureFlagsColumn(result.error)) {
    result = await supabase.from(licensesTable).update(withoutFeatureFlags(payload)).eq("id", licenseId).select(licenseSelectWithoutFeatures).single();
  }
  if (result.error || !result.data) {
    throw new Error(result.error?.message || "license-update-failed");
  }
  return normalizeLicenseDeviceLimit(result.data as LicenseRow);
}

function normalizeLicenseDeviceLimit(license: LicenseRow): LicenseRow {
  return {
    ...license,
    max_devices: 1,
    feature_flags: normalizeFeatureFlagsWithNotes(license.feature_flags, license.notes),
    notes: stripFeatureFlagsFromNotes(license.notes)
  };
}

async function resolveProfile(body: Pick<AdminLicenseBody, "email" | "userId">, supabase: ReturnType<typeof serviceClient>): Promise<SiteProfileRow> {
  const userId = stringValue(body.userId);
  if (userId) {
    const profile = await supabase.from(profilesTable).select(adminProfileSelect).eq("user_id", userId).single();
    if (profile.error || !profile.data?.user_id) {
      throw new Error("해당 사용자 계정을 찾을 수 없습니다.");
    }
    return profile.data as SiteProfileRow;
  }

  const email = stringValue(body.email)?.toLowerCase();
  if (!email) {
    throw new Error("email 또는 userId가 필요합니다.");
  }

  const profile = await supabase.from(profilesTable).select(adminProfileSelect).ilike("email", email).single();
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
  if (!["pending", "inactive", "active", "expired", "suspended"].includes(status)) {
    throw new Error("status는 pending, inactive, active, expired, suspended 중 하나여야 합니다.");
  }
  return status;
}

function resolveCreateLimits(plan: string, body: AdminLicenseBody): PlanLimits {
  return applyManualLimitInput(planLimits[plan], body);
}

function resolveUpdateLimits(target: LicenseRow, plan: string, body: AdminLicenseBody): PlanLimits {
  const planDefaults = planLimits[plan];
  const planChanged = plan !== target.plan;
  return applyManualLimitInput(
    {
      ...planDefaults,
      maxSignatures: planChanged ? planDefaults.maxSignatures : target.max_signatures,
      maxMediaMb: planChanged ? planDefaults.maxMediaMb : target.max_media_mb,
      sharedSyncEnabled: planChanged ? planDefaults.sharedSyncEnabled : target.shared_sync_enabled
    },
    body
  );
}

function applyManualLimitInput(base: PlanLimits, body: AdminLicenseBody): PlanLimits {
  const absoluteSignatures = nonNegativeIntegerValue(body.maxSignatures, "시그니처 제한");
  const absoluteMediaMb = nonNegativeIntegerValue(body.maxMediaMb, "미디어 용량");
  const sharedSyncEnabled = booleanValue(body.sharedSyncEnabled, "공유 코드 동기화");
  const addSignatures = nonNegativeIntegerValue(body.addSignatures ?? body.addMaxSignatures, "추가 시그니처 수") || 0;
  const addMediaMb = nonNegativeIntegerValue(body.addMediaMb ?? body.addMaxMediaMb, "추가 미디어 MB") || 0;

  return {
    ...base,
    maxSignatures: addLimit(absoluteSignatures ?? base.maxSignatures, addSignatures, "시그니처 제한"),
    maxMediaMb: addLimit(absoluteMediaMb ?? base.maxMediaMb, addMediaMb, "미디어 용량"),
    sharedSyncEnabled: sharedSyncEnabled ?? base.sharedSyncEnabled
  };
}

function addLimit(base: number, addition: number, label: string): number {
  const next = base + addition;
  if (!Number.isSafeInteger(next) || next < 0 || next > maxManualLimit) {
    throw new Error(`${label}은 0 이상 ${maxManualLimit.toLocaleString("ko-KR")} 이하로 입력해 주세요.`);
  }
  return next;
}

function nonNegativeIntegerValue(value: unknown, label: string): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isSafeInteger(number) || number < 0 || number > maxManualLimit) {
    throw new Error(`${label}은 0 이상 ${maxManualLimit.toLocaleString("ko-KR")} 이하의 정수여야 합니다.`);
  }
  return number;
}

function booleanValue(value: unknown, label: string): boolean | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${label} 값은 true 또는 false여야 합니다.`);
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
  return readJsonObject(req);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}
