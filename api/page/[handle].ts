// GET /api/page/:handle — 공개 페이지 뷰 (WEB_TECH_SPEC §2.1)
// active 페이지 + published 시그니처(pinned 우선, 금액 오름차순) + 디바이스
// online 여부. suspended/hidden은 존재를 숨기기 위해 동일하게 404 not-found.

import type { IncomingMessage, ServerResponse } from "node:http";

import type { PublicPageView, PublicSignatureCard } from "../_webShared.js";
import { normalizeTeamCode, sharedBundleToSignatureCards, teamCodeThumbPaths } from "../_webShared.js";
import {
  TABLES,
  applyCors,
  handlePreflight,
  isDeviceOnline,
  publicAccountInfo,
  routeParam,
  sanitizeBroadcastLinks,
  sanitizePresetAmounts,
  sanitizeTransferLinks,
  sendErr,
  sendOk,
  sendServerError,
  serviceClient,
  type ServiceClient
} from "../_webServer.js";

type PageRow = {
  id: string;
  owner_user_id: string;
  handle: string;
  banner_url: string | null;
  avatar_url: string | null;
  bio: string | null;
  broadcast_links: unknown;
  preset_amounts: unknown;
  min_amount: number;
  ticker_public: boolean;
  account_display: string;
  account_info: unknown;
  transfer_links: unknown;
  status: string;
  team_code: string | null;
};

type SignatureRow = {
  id: string;
  title: string;
  web_title: string | null;
  amount: number;
  media_type: PublicSignatureCard["mediaType"];
  thumb_url: string | null;
  pinned: boolean;
};

const pageSelect =
  "id,owner_user_id,handle,banner_url,avatar_url,bio,broadcast_links,preset_amounts," +
  "min_amount,ticker_public,account_display,account_info,transfer_links,status,team_code";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  applyCors(res);
  if (handlePreflight(req, res)) return;
  if (req.method !== "GET") {
    sendErr(res, 405, "method-not-allowed");
    return;
  }

  try {
    // 경로: /api/page/:handle → 세그먼트 ['api','page',handle]
    const handle = routeParam(req, "handle", 2)?.toLowerCase();
    if (!handle) {
      sendErr(res, 404, "not-found");
      return;
    }

    const supabase = serviceClient();
    const pageResult = await supabase.from(TABLES.pages).select(pageSelect).eq("handle", handle).maybeSingle();
    if (pageResult.error) {
      throw new Error(pageResult.error.message);
    }
    const page = pageResult.data as PageRow | null;
    if (!page || page.status !== "active") {
      // hidden/suspended도 404 — 존재 여부를 구분해 주지 않는다 (§5)
      sendErr(res, 404, "not-found");
      return;
    }

    const [profileResult, signaturesResult, devicesResult] = await Promise.all([
      supabase.from(TABLES.profiles).select("nickname").eq("user_id", page.owner_user_id).maybeSingle(),
      supabase
        .from(TABLES.signatures)
        .select("id,title,web_title,amount,media_type,thumb_url,pinned")
        .eq("page_id", page.id)
        .eq("published", true)
        .order("pinned", { ascending: false })
        .order("amount", { ascending: true })
        .order("sort", { ascending: true }),
      supabase.from(TABLES.relayDevices).select("last_heartbeat_at").eq("page_id", page.id).eq("active", true)
    ]);
    if (signaturesResult.error) {
      throw new Error(signaturesResult.error.message);
    }
    if (devicesResult.error) {
      throw new Error(devicesResult.error.message);
    }

    const nickname = (profileResult.data as { nickname: string } | null)?.nickname;
    const now = Date.now();
    const online = ((devicesResult.data ?? []) as { last_heartbeat_at: string | null }[]).some((device) =>
      isDeviceOnline(device.last_heartbeat_at, now)
    );

    let signatures: PublicSignatureCard[] = ((signaturesResult.data ?? []) as SignatureRow[]).map((row) => ({
      id: row.id,
      title: row.web_title ?? row.title,
      amount: row.amount,
      mediaType: row.media_type,
      thumbUrl: row.thumb_url,
      mediaUrl: null,
      pinned: row.pinned
    }));

    // 팀코드가 설정된 페이지는 프로그램 공유 번들(최신 finalized)이 메뉴의 진실 —
    // 성공 시 bbbb_page_signatures를 대체(병합 아님), 실패·미발행 시 기존 경로 유지.
    if (page.team_code) {
      const teamSignatures = await teamCodeSignatures(supabase, page.team_code);
      if (teamSignatures) {
        signatures = teamSignatures;
      }
    }

    const view: PublicPageView = {
      handle: page.handle,
      displayName: nickname || page.handle,
      bannerUrl: page.banner_url,
      avatarUrl: page.avatar_url,
      bio: page.bio,
      broadcastLinks: sanitizeBroadcastLinks(page.broadcast_links),
      presetAmounts: sanitizePresetAmounts(page.preset_amounts),
      minAmount: page.min_amount,
      tickerPublic: page.ticker_public,
      online,
      signatures,
      transferLinks: sanitizeTransferLinks(page.transfer_links),
      accountInfo: publicAccountInfo(page.account_display, page.account_info)
    };
    sendOk(res, view);
  } catch (error) {
    sendServerError(res, error);
  }
}

// ---------------------------------------------------------------------------
// 팀코드 → 시그니처 메뉴 (bbbb_shared_profile_versions 최신 finalized 번들)
// ---------------------------------------------------------------------------

const SHARED_VERSIONS_TABLE = "bbbb_shared_profile_versions";
// api/shared-profile.ts와 동일 규칙(비공개 버킷 — 서명 URL 필수)
const SHARED_MEDIA_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "bbbb-shared-media";
const SIGNED_URL_TTL_SECONDS = 3600;

/**
 * 팀코드의 최신 finalized 공유 번들에서 시그니처 카드 목록을 만든다.
 * - 팀코드 문제(형식 위반·미발행·쿼리 실패)는 절대 500을 내지 않는다 — null을
 *   반환해 호출자가 기존 bbbb_page_signatures 경로로 폴백하게 한다.
 * - finalized 번들이 있으면 그 목록이 전체 메뉴다(빈 목록 포함, 대체이지 병합 아님).
 * - 이미지 썸네일 서명 URL은 한 번의 createSignedUrls 배치로 발급하고, 발급 실패는
 *   썸네일만 포기(null)하며 메뉴 자체는 유지한다.
 */
async function teamCodeSignatures(supabase: ServiceClient, teamCode: string): Promise<PublicSignatureCard[] | null> {
  try {
    const code = normalizeTeamCode(teamCode);
    if (!code) return null;

    const result = await supabase
      .from(SHARED_VERSIONS_TABLE)
      .select("bundle,media_files")
      .eq("code", code)
      .eq("status", "finalized")
      .order("version", { ascending: false })
      .limit(1);
    if (result.error) return null;
    const row = (result.data?.[0] ?? null) as { bundle: unknown; media_files: unknown } | null;
    if (!row) return null;

    const paths = teamCodeThumbPaths(row.bundle, row.media_files);
    const signedUrlByPath: Record<string, string> = {};
    if (paths.length > 0) {
      try {
        const signed = await supabase.storage.from(SHARED_MEDIA_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
        for (const entry of signed.data ?? []) {
          if (entry.path && entry.signedUrl && !entry.error) {
            signedUrlByPath[entry.path] = entry.signedUrl;
          }
        }
      } catch {
        // 서명 URL 실패 → 썸네일 없이 메뉴 유지
      }
    }
    return sharedBundleToSignatureCards(row.bundle, row.media_files, signedUrlByPath);
  } catch {
    return null;
  }
}
