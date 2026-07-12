import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { isOwnerEmail } from "./_owner.js";
import { ENTERPRISE_NAME_MAX, normalizeEnterpriseSlug } from "./_webShared.js";

// =============================================================================
// /api/admin-enterprises — 엔터(소속 엔터테인먼트) 관리 (관리자 전용)
// GET                 : 엔터 목록 + 소속 페이지 수 { enterprises: [{id,slug,name,pageCount}] }
// POST  {name, slug}  : 엔터 생성 (slug 중복 409)
// PATCH {slug, name}  : 엔터 이름 변경 (slug가 대상 식별자)
// 인증: api/admin-web-page.ts assertAdmin과 동일(공유 토큰 헤더 또는 관리자 세션 Bearer).
// v1 정책(VIEWER_MESSAGE_RELAY_PLAN §5): 엔터 생성·페이지 배정은 관리자 전용(사칭
// 방지) — 스트리머 자가 배정 없음. 페이지 배정은 /api/admin-web-page enterprise_slug.
// bbbb_enterprises 미생성 DB에서는 DB 오류 메시지를 그대로 노출한다(관리자 화면 전용).
// =============================================================================

type AdminEnterprisesBody = {
  name?: unknown;
  slug?: unknown;
};

type EnterpriseRow = {
  id: string;
  slug: string;
  name: string;
};

type EnterpriseListItem = EnterpriseRow & { pageCount: number };

const enterprisesTable = "bbbb_enterprises";
const pagesTable = "bbbb_streamer_pages";
const siteProfilesTable = "bbbb_site_profiles";
const enterpriseSelect = "id,slug,name";

const PAGE_COUNT_SCAN_LIMIT = 5000;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!["GET", "POST", "PATCH"].includes(req.method || "")) {
    sendJson(res, 405, { ok: false, error: "허용되지 않은 요청입니다.", code: "method-not-allowed" });
    return;
  }

  try {
    const supabase = serviceClient();
    await assertAdmin(req, supabase);

    if (req.method === "GET") {
      await listEnterprises(res, supabase);
      return;
    }

    const body = await readJson(req);
    if (req.method === "POST") {
      await createEnterprise(res, body, supabase);
      return;
    }
    await renameEnterprise(res, body, supabase);
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, { ok: false, error: error.message, code: error.code });
      return;
    }
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "admin-enterprises-request-failed" });
  }
}

// ---------------------------------------------------------------------------
// GET — 엔터 목록 + 소속 페이지 수
// ---------------------------------------------------------------------------

async function listEnterprises(res: ServerResponse, supabase: Supa): Promise<void> {
  const result = await supabase
    .from(enterprisesTable)
    .select(`${enterpriseSelect},created_at`)
    .order("created_at", { ascending: true });
  if (result.error) {
    throw new Error(result.error.message);
  }
  const rows = (result.data || []) as (EnterpriseRow & { created_at: string })[];
  const counts = await fetchPageCounts(supabase, rows.map((row) => row.id));
  const enterprises: EnterpriseListItem[] = rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    pageCount: counts.get(row.id) || 0
  }));
  sendJson(res, 200, { ok: true, data: { enterprises } });
}

/** 소속 페이지 수 집계 — 초기 규모(페이지 수백 건)에 맞춘 단순 in-select 집계 */
async function fetchPageCounts(supabase: Supa, enterpriseIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (!enterpriseIds.length) return counts;
  const result = await supabase
    .from(pagesTable)
    .select("enterprise_id")
    .in("enterprise_id", enterpriseIds)
    .limit(PAGE_COUNT_SCAN_LIMIT);
  if (result.error) {
    throw new Error(result.error.message);
  }
  for (const row of (result.data || []) as { enterprise_id: string | null }[]) {
    if (!row.enterprise_id) continue;
    counts.set(row.enterprise_id, (counts.get(row.enterprise_id) || 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// POST — 엔터 생성 (slug 중복 409, lower(slug) 유니크 인덱스가 최종 게이트)
// ---------------------------------------------------------------------------

async function createEnterprise(res: ServerResponse, body: AdminEnterprisesBody, supabase: Supa): Promise<void> {
  const slug = requireSlug(body.slug);
  const name = requireName(body.name);

  const insert = await supabase.from(enterprisesTable).insert({ slug, name }).select(enterpriseSelect).single();
  if (insert.error) {
    if (insert.error.code === "23505") {
      throw new ApiError(409, "slug-taken", "이미 등록된 엔터 슬러그입니다.");
    }
    throw new Error(insert.error.message);
  }

  const row = insert.data as EnterpriseRow;
  sendJson(res, 200, {
    ok: true,
    data: { created: true, enterprise: { id: row.id, slug: row.slug, name: row.name, pageCount: 0 } }
  });
}

// ---------------------------------------------------------------------------
// PATCH — 엔터 이름 변경 (slug 불변 — 공개 URL·필터 키라 v1은 rename만)
// ---------------------------------------------------------------------------

async function renameEnterprise(res: ServerResponse, body: AdminEnterprisesBody, supabase: Supa): Promise<void> {
  const slug = requireSlug(body.slug);
  const name = requireName(body.name);

  const found = await supabase.from(enterprisesTable).select("id").ilike("slug", slug).limit(1);
  if (found.error) {
    throw new Error(found.error.message);
  }
  const id = ((found.data?.[0] ?? null) as { id: string } | null)?.id;
  if (!id) {
    throw new ApiError(404, "not-found", "등록되지 않은 엔터입니다.");
  }

  const update = await supabase.from(enterprisesTable).update({ name }).eq("id", id).select(enterpriseSelect).single();
  if (update.error) {
    throw new Error(update.error.message);
  }

  const row = update.data as EnterpriseRow;
  const counts = await fetchPageCounts(supabase, [row.id]);
  sendJson(res, 200, {
    ok: true,
    data: {
      created: false,
      enterprise: { id: row.id, slug: row.slug, name: row.name, pageCount: counts.get(row.id) || 0 }
    }
  });
}

// ---------------------------------------------------------------------------
// 입력 정규화 (api/_webShared.ts 엔터 규칙 — DB check 제약과 동일)
// ---------------------------------------------------------------------------

function requireSlug(input: unknown): string {
  const slug = normalizeEnterpriseSlug(input);
  if (!slug) {
    throw new ApiError(400, "validation-failed", "엔터 슬러그는 영문 소문자·숫자·하이픈 1~30자입니다(첫 글자는 영문·숫자).");
  }
  return slug;
}

function requireName(input: unknown): string {
  const name = typeof input === "string" ? input.trim() : "";
  if (!name || name.length > ENTERPRISE_NAME_MAX) {
    throw new ApiError(400, "validation-failed", `엔터 이름은 1~${ENTERPRISE_NAME_MAX}자로 입력해 주세요.`);
  }
  return name;
}

// ---------------------------------------------------------------------------
// 인증·공통 유틸 (api/admin-web-page.ts와 동일 관례 — assertAdmin 동일 규칙)
// ---------------------------------------------------------------------------

type Supa = ReturnType<typeof serviceClient>;

class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function assertAdmin(req: IncomingMessage, supabase: Supa): Promise<void> {
  const expected = process.env.BBBB_SHARED_ADMIN_TOKEN;
  const received = req.headers["x-bbbb-admin-token"];
  const token = Array.isArray(received) ? received[0] : received;
  if (expected && token === expected) {
    return;
  }

  const sessionToken = bearerToken(req);
  if (!sessionToken) {
    throw new ApiError(401, "auth-required", "관리자 권한이 필요합니다.");
  }

  const userResult = await supabase.auth.getUser(sessionToken);
  const user = userResult.data.user;
  if (userResult.error || !user) {
    throw new ApiError(401, "auth-required", "로그인 세션을 확인할 수 없습니다.");
  }
  if (isOwnerEmail(user.email || null)) {
    return;
  }

  const profile = await supabase.from(siteProfilesTable).select("role").eq("user_id", user.id).single();
  if (profile.error || profile.data?.role !== "admin") {
    throw new ApiError(403, "forbidden", "관리자 계정만 엔터를 관리할 수 있습니다.");
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

async function readJson(req: IncomingMessage): Promise<AdminEnterprisesBody> {
  // vercel dev는 바디를 req.body로만 제공 — 우선 사용 후 스트림 폴백
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) {
    if (typeof pre === "string") {
      try {
        const parsed = JSON.parse(pre) as unknown;
        return (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as AdminEnterprisesBody;
      } catch {
        return {} as AdminEnterprisesBody;
      }
    }
    return (pre && typeof pre === "object" && !Array.isArray(pre) ? pre : {}) as AdminEnterprisesBody;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as AdminEnterprisesBody;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PATCH,OPTIONS",
    "access-control-allow-headers": "authorization,content-type,x-bbbb-admin-token"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization,content-type,x-bbbb-admin-token");
}
