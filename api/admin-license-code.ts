import { createHash, randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  normalizeFeatureFlags,
  normalizeFeatureFlagsWithNotes,
  notesWithFeatureFlags,
  stripFeatureFlagsFromNotes,
  type FeatureFlags
} from "./_feature-flags.js";
import { AdminRequestError, requireAdminUser } from "./_admin-auth.js";
import { readJsonObject, RequestBodyError } from "./_request-body.js";
import {
  licenseCodeSharedSyncFromNotes,
  notesWithLicenseCodeSharedSync,
  stripLicenseCodeSharedSyncFromNotes
} from "./_license-code-options.js";
import { isMissingFeatureFlagsColumn, withoutFeatureFlags } from "./_schema-fallback.js";

type AdminCodeBody = {
  mode?: unknown;
  plan?: unknown;
  durationUnit?: unknown;
  durationValue?: unknown;
  maxRedemptions?: unknown;
  validUntil?: unknown;
  notes?: unknown;
  featureFlags?: unknown;
  sharedSyncEnabled?: unknown;
};

type CodeMode = "account" | "guest";

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
  "id,code_prefix,plan,duration_hours,max_redemptions,redeemed_count,valid_until,is_active,feature_flags,notes,created_by,created_at,updated_at";
const codeSelectWithoutFeatures =
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
    maxDevices: 1,
    sharedSyncEnabled: true
  }
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    const adminUserId = (await requireAdminUser(req, supabase)).userId;
    if (req.method === "GET") {
      await listCodes(res, supabase);
      return;
    }
    await createCode(res, await readJson(req), adminUserId, supabase);
  } catch (error) {
    if (error instanceof AdminRequestError) {
      sendJson(res, error.status, { ok: false, error: error.message, code: error.code });
      return;
    }
    if (error instanceof RequestBodyError) {
      sendJson(res, error.status, { ok: false, error: error.message, code: error.code });
      return;
    }
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "license-code-request-failed" });
  }
}

async function listCodes(res: ServerResponse, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  let codes: { data: unknown; error: { message: string } | null } = await supabase
    .from(licenseCodesTable)
    .select(codeSelect)
    .order("created_at", { ascending: false })
    .limit(20);
  if (isMissingFeatureFlagsColumn(codes.error)) {
    codes = await supabase.from(licenseCodesTable).select(codeSelectWithoutFeatures).order("created_at", { ascending: false }).limit(20);
  }
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

  sendJson(res, 200, { ok: true, data: { codes: normalizeCodeRows(codes.data), redemptions: redemptions.data || [] } });
}

async function createCode(
  res: ServerResponse,
  body: AdminCodeBody,
  adminUserId: string,
  supabase: ReturnType<typeof serviceClient>
): Promise<void> {
  const plan = normalizePlan(body.plan);
  const mode = normalizeMode(body.mode);
  const durationHours = normalizeDuration(body.durationUnit, body.durationValue);
  const maxRedemptions = integerValue(body.maxRedemptions, 1, 1000) || 1;
  const validUntil = dateValue(body.validUntil);
  const code = createPlainCode(plan, mode);
  const codePrefix = code.split("-").slice(0, 4).join("-");
  const now = new Date().toISOString();
  const sharedSyncEnabled = booleanValue(body.sharedSyncEnabled, "공유 코드 동기화") ?? planLimits[plan].sharedSyncEnabled;
  const limits = { ...planLimits[plan], sharedSyncEnabled };
  const featureFlags: FeatureFlags = normalizeFeatureFlags(body.featureFlags);
  const notes = stringValue(body.notes)?.slice(0, 1000);
  const notesPayload = notesWithLicenseCodeSharedSync(
    notesWithFeatureFlags([`mode:${mode}`, notes].filter(Boolean).join(" | ") || null, featureFlags),
    sharedSyncEnabled
  );

  const payload = {
      code_hash: hashCode(code),
      code_prefix: codePrefix,
      plan,
      duration_hours: durationHours,
      max_redemptions: maxRedemptions,
      redeemed_count: 0,
      valid_until: validUntil,
      is_active: true,
      feature_flags: featureFlags,
      notes: notesPayload,
      created_by: adminUserId,
      updated_at: now
    };

  const codeInfo = await insertCode(payload, supabase);

  sendJson(res, 200, {
    ok: true,
    data: {
      code,
      mode,
      codeInfo,
      limits
    }
  });
}

async function insertCode(payload: Record<string, unknown>, supabase: ReturnType<typeof serviceClient>): Promise<Record<string, unknown>> {
  let result = await supabase.from(licenseCodesTable).insert(payload).select(codeSelect).single();
  if (isMissingFeatureFlagsColumn(result.error)) {
    result = await supabase.from(licenseCodesTable).insert(withoutFeatureFlags(payload)).select(codeSelectWithoutFeatures).single();
  }
  if (result.error || !result.data) {
    throw new Error(result.error?.message || "license-code-create-failed");
  }
  return normalizeCodeRow(result.data);
}

function normalizeCodeRows(input: unknown): Record<string, unknown>[] {
  return Array.isArray(input) ? input.map(normalizeCodeRow) : [];
}

function normalizeCodeRow(input: unknown): Record<string, unknown> {
  const row = isRecord(input) ? input : {};
  return {
    ...row,
    shared_sync_enabled: licenseCodeSharedSyncFromNotes(row.notes),
    feature_flags: normalizeFeatureFlagsWithNotes(row.feature_flags, row.notes),
    notes: stripLicenseCodeSharedSyncFromNotes(stripFeatureFlagsFromNotes(row.notes))
  };
}

function createPlainCode(plan: string, mode: CodeMode): string {
  const planPrefix = plan.slice(0, 3).toUpperCase();
  const raw = randomBytes(9).toString("hex").toUpperCase();
  const modePrefix = mode === "guest" ? "GST" : "ACC";
  return `GD-${modePrefix}-${planPrefix}-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
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

function normalizeMode(value: unknown): CodeMode {
  const mode = stringValue(value)?.toLowerCase() || "account";
  if (mode === "guest" || mode === "account") {
    return mode;
  }
  throw new Error("mode는 account 또는 guest여야 합니다.");
}

function normalizeDuration(unitValue: unknown, amountValue: unknown): number | null {
  const rawUnit = stringValue(unitValue)?.toLowerCase() || "day";
  const unit = rawUnit === "days" ? "day" : rawUnit === "hours" ? "hour" : rawUnit;
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

async function readJson(req: IncomingMessage): Promise<AdminCodeBody> {
  return readJsonObject(req);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}
