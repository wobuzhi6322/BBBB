import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { HANDLE_HISTORY_TABLE, validateHandleChange, type HandleHistoryRow } from "./_handlePolicy.js";
import { isOwnerEmail } from "./_owner.js";
import { constantTimeEqual, handleRejectCode, normalizeEnterpriseSlug } from "./_webShared.js";
import { nicknameFromEmail } from "./me/profile.js";
import { handleErrorMessage, normalizeHandleInput, rolesWithStreamer } from "./onboard-streamer.js";

// =============================================================================
// /api/admin-web-page — 관리자 대행 웹 채널(스트리머 페이지) 등록·수정
// GET   ?email=            : 이메일로 계정·기존 페이지 상태 조회
// POST  {email, handle, nickname?, team_code?, directory_optin?, enterprise_slug?}
//                          : 기존 라이선스 계정을 웹 채널로 등록 (계정 생성 없음)
// PATCH {handle, team_code?, directory_optin?, status?, enterprise_slug?}
//                          : 기존 페이지의 팀코드·공개 여부·상태·엔터 소속 수정
// enterprise_slug: 등록된 엔터 slug로 소속 지정, null·빈 문자열은 소속 해제,
//                  미등록 slug는 404. 배정은 관리자 전용(v1 사칭 방지 정책 — §5).
// 인증: api/admin-devices.ts와 동일(공유 토큰 헤더 또는 관리자 세션 Bearer).
// =============================================================================

type AdminWebPageBody = {
  email?: unknown;
  handle?: unknown;
  nickname?: unknown;
  team_code?: unknown;
  directory_optin?: unknown;
  status?: unknown;
  enterprise_slug?: unknown;
};

type SiteProfileRow = {
  user_id: string;
  email: string | null;
  role: string;
};

/** bbbb_streamer_pages 행 (team_code·enterprise_id는 additive 컬럼 — 마이그레이션 전 배포 허용을 위해 optional) */
type PageRow = {
  id: string;
  owner_user_id: string;
  handle: string;
  directory_optin: boolean;
  status: string;
  team_code?: string | null;
  enterprise_id?: string | null;
};

type PageSummary = {
  handle: string;
  team_code: string | null;
  directory_optin: boolean;
  status: string;
  enterprise_slug: string | null;
};

const siteProfilesTable = "bbbb_site_profiles";
const pagesTable = "bbbb_streamer_pages";
const webProfilesTable = "bbbb_web_profiles";
const enterprisesTable = "bbbb_enterprises";
const siteProfileSelect = "user_id,email,role";

const NICKNAME_MAX = 20;

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method || "")) {
    sendJson(res, 405, { ok: false, error: "허용되지 않은 요청입니다.", code: "method-not-allowed" });
    return;
  }

  try {
    const supabase = serviceClient();
    await assertAdmin(req, supabase);

    if (req.method === "GET") {
      await lookupByEmail(req, res, supabase);
      return;
    }

    const body = await readJson(req);
    if (req.method === "POST") {
      await registerPage(res, body, supabase);
      return;
    }
    if (req.method === "DELETE") {
      await deletePage(res, body, supabase);
      return;
    }
    await updatePage(res, body, supabase);
  } catch (error) {
    if (error instanceof ApiError) {
      sendJson(res, error.status, { ok: false, error: error.message, code: error.code });
      return;
    }
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "admin-web-page-request-failed" });
  }
}

// ---------------------------------------------------------------------------
// GET ?email= — 계정·기존 페이지 조회
// ---------------------------------------------------------------------------

async function lookupByEmail(req: IncomingMessage, res: ServerResponse, supabase: Supa): Promise<void> {
  const url = new URL(req.url || "/api/admin-web-page", "https://bbbb.local");
  const email = (url.searchParams.get("email") || "").trim().toLowerCase();
  if (!email) {
    throw new ApiError(400, "validation-failed", "회원 이메일을 입력해 주세요.");
  }

  const profile = await findSiteProfileByEmail(supabase, email);
  if (!profile) {
    sendJson(res, 200, { ok: true, data: { found: false, userId: null, hasPage: false, page: null } });
    return;
  }

  const page = await findPageByOwner(supabase, profile.user_id);
  sendJson(res, 200, {
    ok: true,
    data: {
      found: true,
      userId: profile.user_id,
      hasPage: page !== null,
      page: page ? await pageSummary(supabase, page) : null
    }
  });
}

// ---------------------------------------------------------------------------
// POST — 관리자 대행 등록 (기존 라이선스 계정 전용, 계정 생성 없음)
// ---------------------------------------------------------------------------

async function registerPage(res: ServerResponse, body: AdminWebPageBody, supabase: Supa): Promise<void> {
  const email = stringValue(body.email)?.toLowerCase();
  if (!email) {
    throw new ApiError(400, "validation-failed", "회원 이메일을 입력해 주세요.");
  }

  const profile = await findSiteProfileByEmail(supabase, email);
  if (!profile) {
    throw new ApiError(404, "not-found", "해당 이메일의 계정이 없습니다.");
  }

  const handle = normalizeHandleInput(body.handle);
  const reject = handleRejectCode(handle);
  if (reject) {
    throw new ApiError(400, reject, handleErrorMessage(reject));
  }

  const mine = await findPageByOwner(supabase, profile.user_id);
  if (mine) {
    throw new ApiError(409, "validation-failed", `이 계정에는 이미 웹 채널(@${mine.handle})이 있습니다. 수정 모드를 사용하세요.`);
  }

  const taken = await findPageByHandle(supabase, handle);
  if (taken) {
    throw new ApiError(409, "handle-taken", handleErrorMessage("handle-taken"));
  }

  // 구 핸들 90일 재사용 잠금 (onboard-streamer와 동일 정책 — 301 보호)
  const historyResult = await supabase
    .from(HANDLE_HISTORY_TABLE)
    .select("page_id,changed_at")
    .eq("old_handle", handle)
    .maybeSingle();
  if (historyResult.error) {
    throw new Error(historyResult.error.message);
  }
  const historyRaw = historyResult.data as { page_id: string; changed_at: string } | null;
  const historyRow: HandleHistoryRow | null = historyRaw
    ? { pageId: historyRaw.page_id, changedAt: historyRaw.changed_at }
    : null;
  const verdict = validateHandleChange({
    newHandle: handle,
    currentHandle: "",
    handleChangedAt: null,
    pageId: null,
    historyRow,
    nowMs: Date.now()
  });
  if (!verdict.ok) {
    throw new ApiError(verdict.status, verdict.code, verdict.message);
  }

  const teamCode = normalizeTeamCodeInput(body.team_code);
  const enterpriseId =
    body.enterprise_slug === undefined ? null : await enterpriseIdFromSlugInput(supabase, body.enterprise_slug);
  const providedNickname = normalizeNicknameInput(body.nickname);
  const nickname = providedNickname || nicknameFromEmail(email);
  const directoryOptin = body.directory_optin === undefined ? true : booleanValue(body.directory_optin, "directory_optin");

  await ensureWebProfile(supabase, profile.user_id, nickname, providedNickname !== null);

  const insertPayload: Record<string, unknown> = {
    owner_user_id: profile.user_id,
    handle,
    directory_optin: directoryOptin,
    status: "active"
  };
  if (teamCode) {
    insertPayload.team_code = teamCode;
  }
  if (enterpriseId) {
    insertPayload.enterprise_id = enterpriseId;
  }

  const insert = await supabase.from(pagesTable).insert(insertPayload).select("*").single();
  if (insert.error) {
    if (insert.error.code === "23505") {
      throw new ApiError(409, "handle-taken", handleErrorMessage("handle-taken"));
    }
    throw new Error(insert.error.message);
  }

  sendJson(res, 200, { ok: true, data: { created: true, page: await pageSummary(supabase, insert.data as PageRow) } });
}

// ---------------------------------------------------------------------------
// PATCH — 팀코드·공개 여부·상태 수정 (handle이 대상 식별자)
// ---------------------------------------------------------------------------

async function updatePage(res: ServerResponse, body: AdminWebPageBody, supabase: Supa): Promise<void> {
  const handle = normalizeHandleInput(body.handle);
  if (!handle) {
    throw new ApiError(400, "validation-failed", "수정할 채널 핸들을 입력해 주세요.");
  }

  const page = await findPageByHandle(supabase, handle);
  if (!page) {
    throw new ApiError(404, "not-found", "해당 핸들의 웹 채널이 없습니다.");
  }

  const patch: Record<string, unknown> = {};

  if (body.team_code !== undefined) {
    if (body.team_code === null || (typeof body.team_code === "string" && !body.team_code.trim())) {
      patch.team_code = null;
    } else {
      patch.team_code = normalizeTeamCodeInput(body.team_code);
    }
  }

  if (body.directory_optin !== undefined) {
    patch.directory_optin = booleanValue(body.directory_optin, "directory_optin");
  }

  if (body.status !== undefined) {
    const status = stringValue(body.status)?.toLowerCase();
    if (status !== "active" && status !== "hidden") {
      throw new ApiError(400, "validation-failed", "status는 active 또는 hidden만 지정할 수 있습니다.");
    }
    patch.status = status;
  }

  if (body.enterprise_slug !== undefined) {
    patch.enterprise_id = await enterpriseIdFromSlugInput(supabase, body.enterprise_slug);
  }

  if (Object.keys(patch).length === 0) {
    throw new ApiError(400, "validation-failed", "변경할 값을 하나 이상 보내 주세요.");
  }
  patch.updated_at = new Date().toISOString();

  const update = await supabase.from(pagesTable).update(patch).eq("id", page.id).select("*").single();
  if (update.error) {
    throw new Error(update.error.message);
  }

  sendJson(res, 200, { ok: true, data: { created: false, page: await pageSummary(supabase, update.data as PageRow) } });
}

// ---------------------------------------------------------------------------
// DELETE {handle} — 웹 채널(페이지) 삭제
// bbbb_streamer_pages 행만 삭제한다(계정·라이선스는 보존). page_id FK가 전부
// on delete cascade라 시그니처·후원 메시지·매칭·차단·릴레이 기기·핸들 이력이
// 함께 정리되고, 엔터 소속은 set null이다.
// ---------------------------------------------------------------------------

async function deletePage(res: ServerResponse, body: AdminWebPageBody, supabase: Supa): Promise<void> {
  const handle = normalizeHandleInput(body.handle);
  if (!handle) {
    throw new ApiError(400, "validation-failed", "삭제할 채널 핸들을 입력해 주세요.");
  }

  const page = await findPageByHandle(supabase, handle);
  if (!page) {
    throw new ApiError(404, "not-found", "해당 핸들의 웹 채널이 없습니다.");
  }

  const del = await supabase.from(pagesTable).delete().eq("id", page.id);
  if (del.error) {
    throw new Error(del.error.message);
  }

  sendJson(res, 200, { ok: true, data: { deleted: true, handle: page.handle } });
}

// ---------------------------------------------------------------------------
// 입력 정규화
// ---------------------------------------------------------------------------

/**
 * enterprise_slug 입력 → bbbb_enterprises.id.
 * null·빈 문자열 = 소속 해제(null), 형식 위반 400, 미등록 slug 404.
 * bbbb_enterprises 미생성 DB는 DB 오류를 그대로 노출(관리자 API는 조용히 넘기지 않는다).
 */
async function enterpriseIdFromSlugInput(supabase: Supa, input: unknown): Promise<string | null> {
  if (input === null) {
    return null;
  }
  if (typeof input !== "string") {
    throw new ApiError(400, "validation-failed", "enterprise_slug 값은 문자열 또는 null이어야 합니다.");
  }
  if (!input.trim()) {
    return null;
  }
  const slug = normalizeEnterpriseSlug(input);
  if (!slug) {
    throw new ApiError(400, "validation-failed", "엔터 슬러그는 영문 소문자·숫자·하이픈 1~30자입니다(첫 글자는 영문·숫자).");
  }
  const found = await supabase.from(enterprisesTable).select("id").ilike("slug", slug).limit(1);
  if (found.error) {
    throw new Error(found.error.message);
  }
  const id = ((found.data?.[0] ?? null) as { id: string } | null)?.id;
  if (!id) {
    throw new ApiError(404, "not-found", "등록되지 않은 엔터입니다.");
  }
  return id;
}

/** 팀코드(공유 코드) 정규화 — api/shared-profile.ts normalizeCode와 동일 규칙 */
function normalizeTeamCodeInput(input: unknown): string | null {
  const raw = stringValue(input);
  if (!raw) {
    return null;
  }
  const code = raw.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9-]{2,63}$/.test(code)) {
    throw new ApiError(400, "validation-failed", "공유 코드는 영문 대문자, 숫자, 하이픈 3~64자로 입력하세요.");
  }
  return code;
}

function normalizeNicknameInput(input: unknown): string | null {
  const nickname = stringValue(input);
  if (!nickname) {
    return null;
  }
  if (nickname.length > NICKNAME_MAX) {
    throw new ApiError(400, "nickname-invalid", `닉네임은 1~${NICKNAME_MAX}자로 입력해 주세요.`);
  }
  return nickname;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new ApiError(400, "validation-failed", `${label} 값은 true 또는 false여야 합니다.`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// DB 접근
// ---------------------------------------------------------------------------

async function findSiteProfileByEmail(supabase: Supa, email: string): Promise<SiteProfileRow | null> {
  const result = await supabase.from(siteProfilesTable).select(siteProfileSelect).ilike("email", email).maybeSingle();
  if (result.error) {
    throw new Error(result.error.message);
  }
  return (result.data as SiteProfileRow | null) || null;
}

/** select("*") — team_code 마이그레이션 전 스키마에서도 조회가 깨지지 않도록 명시 컬럼을 피한다 */
async function findPageByOwner(supabase: Supa, userId: string): Promise<PageRow | null> {
  const result = await supabase.from(pagesTable).select("*").eq("owner_user_id", userId).maybeSingle();
  if (result.error) {
    throw new Error(result.error.message);
  }
  return (result.data as PageRow | null) || null;
}

async function findPageByHandle(supabase: Supa, handle: string): Promise<PageRow | null> {
  const result = await supabase.from(pagesTable).select("*").eq("handle", handle).maybeSingle();
  if (result.error) {
    throw new Error(result.error.message);
  }
  return (result.data as PageRow | null) || null;
}

/** bbbb_web_profiles 보장: 없으면 생성, 있으면 roles에 streamer 보장(+요청 시 닉네임 갱신) */
async function ensureWebProfile(supabase: Supa, userId: string, nickname: string, nicknameProvided: boolean): Promise<void> {
  const existing = await supabase.from(webProfilesTable).select("user_id,nickname,roles").eq("user_id", userId).maybeSingle();
  if (existing.error) {
    throw new Error(existing.error.message);
  }

  if (!existing.data) {
    const insert = await supabase
      .from(webProfilesTable)
      .insert({ user_id: userId, nickname, roles: rolesWithStreamer([]) });
    if (insert.error) {
      throw new Error(insert.error.message);
    }
    return;
  }

  const roles = rolesWithStreamer((existing.data as { roles: string[] | null }).roles);
  const patch: Record<string, unknown> = { roles, updated_at: new Date().toISOString() };
  if (nicknameProvided) {
    patch.nickname = nickname;
  }
  const update = await supabase.from(webProfilesTable).update(patch).eq("user_id", userId);
  if (update.error) {
    throw new Error(update.error.message);
  }
}

async function pageSummary(supabase: Supa, page: PageRow): Promise<PageSummary> {
  return {
    handle: page.handle,
    team_code: page.team_code ?? null,
    directory_optin: page.directory_optin,
    status: page.status,
    enterprise_slug: await enterpriseSlugById(supabase, page.enterprise_id ?? null)
  };
}

/** enterprise_id → slug (요약 표시용). 무소속·조회 실패는 null — 요약 조회는 조용히 폴백 */
async function enterpriseSlugById(supabase: Supa, enterpriseId: string | null): Promise<string | null> {
  if (!enterpriseId) return null;
  try {
    const result = await supabase.from(enterprisesTable).select("slug").eq("id", enterpriseId).limit(1);
    if (result.error) return null;
    const slug = ((result.data?.[0] ?? null) as { slug?: unknown } | null)?.slug;
    return typeof slug === "string" && slug ? slug : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 인증·공통 유틸 (api/admin-devices.ts 관례)
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
  if (expected && constantTimeEqual(token, expected)) {
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
    throw new ApiError(403, "forbidden", "관리자 계정만 웹 채널을 등록할 수 있습니다.");
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

async function readJson(req: IncomingMessage): Promise<AdminWebPageBody> {
  // vercel dev는 바디를 req.body로만 제공 — 우선 사용 후 스트림 폴백
  const pre = (req as IncomingMessage & { body?: unknown }).body;
  if (pre !== undefined) {
    if (typeof pre === "string") {
      try {
        const parsed = JSON.parse(pre) as unknown;
        return (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as AdminWebPageBody;
      } catch {
        return {} as AdminWebPageBody;
      }
    }
    return (pre && typeof pre === "object" && !Array.isArray(pre) ? pre : {}) as AdminWebPageBody;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as AdminWebPageBody;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
