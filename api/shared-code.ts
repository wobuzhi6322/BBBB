import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { isOwnerEmail, ownerLicense } from "./_owner.js";

type SharedCodeBody = {
  code?: unknown;
};

type LicenseRow = {
  id: string;
  status: string;
  expires_at: string | null;
};

type MemberRow = {
  id: string;
  user_id: string;
  code: string;
  role: "owner" | "editor" | "viewer";
  created_at: string;
};

const profilesTable = "bbbb_site_profiles";
const licensesTable = "bbbb_account_licenses";
const sharedProfilesTable = "bbbb_shared_profiles";
const sharedMembersTable = "bbbb_shared_code_members";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    const supabase = serviceClient();
    const user = await requireUser(req, supabase);
    await ensureProfile(user.id, user.email || null, supabase);

    if (req.method === "GET") {
      await handleList(user.id, res, supabase);
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      const code = normalizeCode(body.code);
      const ownerAccount = isOwnerEmail(user.email || null);
      const license = ownerAccount ? (ownerLicense(user.id) as LicenseRow) : await getActiveLicense(user.id, supabase);
      const membership = await joinSharedCode(user.id, code, supabase);
      sendJson(res, 200, {
        ok: true,
        data: {
          code,
          membership,
          license
        }
      });
      return;
    }

    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "shared-code-failed" });
  }
}

async function handleList(userId: string, res: ServerResponse, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const result = await supabase
    .from(sharedMembersTable)
    .select("id,user_id,code,role,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (result.error) {
    throw new Error(result.error.message);
  }
  sendJson(res, 200, { ok: true, data: { sharedCodes: (result.data || []) as MemberRow[] } });
}

async function joinSharedCode(userId: string, code: string, supabase: ReturnType<typeof serviceClient>): Promise<MemberRow> {
  await ensureSharedProfile(code, supabase);

  const existing = await supabase
    .from(sharedMembersTable)
    .select("id,user_id,code,role,created_at")
    .eq("user_id", userId)
    .eq("code", code)
    .maybeSingle();
  if (existing.error) {
    throw new Error(existing.error.message);
  }
  if (existing.data) {
    return existing.data as MemberRow;
  }

  const countResult = await supabase.from(sharedMembersTable).select("id", { count: "exact", head: true }).eq("code", code);
  if (countResult.error) {
    throw new Error(countResult.error.message);
  }
  const role = (countResult.count || 0) === 0 ? "owner" : "viewer";
  const insert = await supabase
    .from(sharedMembersTable)
    .insert({
      user_id: userId,
      code,
      role
    })
    .select("id,user_id,code,role,created_at")
    .single();
  if (insert.error) {
    throw new Error(insert.error.message);
  }
  return insert.data as MemberRow;
}

async function ensureSharedProfile(code: string, supabase: ReturnType<typeof serviceClient>): Promise<void> {
  const result = await supabase.from(sharedProfilesTable).upsert(
    {
      code,
      updated_at: new Date().toISOString()
    },
    { onConflict: "code" }
  );
  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function getActiveLicense(userId: string, supabase: ReturnType<typeof serviceClient>): Promise<LicenseRow> {
  const result = await supabase
    .from(licensesTable)
    .select("id,status,expires_at")
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

function normalizeCode(input: unknown): string {
  const code = stringValue(input)?.toUpperCase().replace(/[^A-Z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!code || !/^[A-Z0-9][A-Z0-9-]{2,63}$/.test(code)) {
    throw new Error("팀 코드는 영문 대문자, 숫자, 하이픈 3~64자로 입력하세요.");
  }
  return code;
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

async function readJson(req: IncomingMessage): Promise<SharedCodeBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as SharedCodeBody;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization"
  });
  res.end(JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
