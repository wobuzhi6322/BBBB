import { createClient } from "@supabase/supabase-js";
import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

type AuthBody = {
  email?: unknown;
  password?: unknown;
};

const profilesTable = "bbbb_site_profiles";
const licensesTable = "bbbb_account_licenses";
const trialNotes = "system:free-trial-2d";
const trialHours = 48;
const trialFeatureFlags = {
  signatures: true,
  wallpapers: true,
  tagBattle: true,
  chatRace: true,
  manualOverlays: true
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
    const body = await readJson(req);
    const email = requiredString(body.email, "이메일을 입력해 주세요.");
    const password = requiredString(body.password, "비밀번호를 입력해 주세요.");
    const supabase = anonClient();
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) {
      throw new Error(result.error.message);
    }
    const trial = await tryStartFreeTrial(result.data.user?.id, result.data.user?.email || null);
    sendJson(res, 200, {
      ok: true,
      data: {
        session: result.data.session,
        user: result.data.user,
        trial
      }
    });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "auth-login-failed" });
  }
}

async function tryStartFreeTrial(userId: string | undefined, email: string | null): Promise<Record<string, unknown> | null> {
  if (!userId) {
    return null;
  }

  try {
    const supabase = serviceClient();
    await ensureProfile(userId, email, supabase);

    const profile = await supabase.from(profilesTable).select("trial_started_at").eq("user_id", userId).single();
    if (profile.error) {
      throw new Error(profile.error.message);
    }
    if (profile.data?.trial_started_at) {
      return {
        started: false,
        eligible: false,
        message: "무료 체험은 계정당 1회만 제공됩니다."
      };
    }

    const active = await supabase
      .from(licensesTable)
      .select("id,plan,status,expires_at")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("issued_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (active.error) {
      throw new Error(active.error.message);
    }
    if (active.data && (!active.data.expires_at || new Date(active.data.expires_at).getTime() > Date.now())) {
      return {
        started: false,
        eligible: true,
        skipped: "active-license-exists",
        message: "이미 활성화된 이용권이 있어 무료 체험을 시작하지 않습니다."
      };
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + trialHours * 60 * 60 * 1000).toISOString();
    const license = await supabase
      .from(licensesTable)
      .insert({
        user_id: userId,
        license_code: createTrialLicenseCode(),
        plan: "starter",
        status: "active",
        max_signatures: 3,
        max_media_mb: 50,
        max_devices: 1,
        shared_sync_enabled: false,
        feature_flags: trialFeatureFlags,
        notes: trialNotes,
        activated_at: now.toISOString(),
        expires_at: expiresAt,
        updated_at: now.toISOString()
      })
      .select("id,license_code,plan,status,expires_at")
      .single();
    if (license.error || !license.data) {
      throw new Error(license.error?.message || "trial-license-create-failed");
    }

    const updateProfile = await supabase
      .from(profilesTable)
      .update({
        trial_started_at: now.toISOString(),
        trial_license_id: license.data.id,
        updated_at: now.toISOString()
      })
      .eq("user_id", userId);
    if (updateProfile.error) {
      throw new Error(updateProfile.error.message);
    }

    return {
      started: true,
      eligible: false,
      durationHours: trialHours,
      message: "무료 체험이 시작되었습니다. 프로그램 첫 로그인 기준 2일 동안 Starter 기능을 사용할 수 있습니다.",
      license: license.data
    };
  } catch (error) {
    return {
      started: false,
      eligible: true,
      error: error instanceof Error ? error.message : "trial-start-failed"
    };
  }
}

function anonClient() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
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

function createTrialLicenseCode(): string {
  const raw = randomBytes(8).toString("hex").toUpperCase();
  return `TRIAL-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
}

async function readJson(req: IncomingMessage): Promise<AuthBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as AuthBody;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
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
