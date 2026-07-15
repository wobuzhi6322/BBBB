// POST /api/relay/signatures-sync — 시그니처 메뉴판 캐시 push (WEB_TECH_SPEC §2.4·§1.2)
// (page_id, local_signature_id) 기준 upsert, 목록에 없는 기존 행 삭제(진실은
// 로컬). thumbBase64가 있으면 bbbb-web-thumbs 버킷에 {pageId}/{localSignatureId}.jpg
// 로 업로드 후 thumb_url 갱신 — 200KB 초과분은 해당 항목 썸네일만 스킵 표시.
// 완료 시 디바이스 signatures_dirty=false.
// published/pinned/web_title/sort는 스튜디오(WSC) 소유 컬럼이라 기존 행에서는
// 건드리지 않는다(페이로드에서 제외 → 기존 값 유지). 단 **신규 행은
// published=true로 생성**한다 — 프로그램에서 켜져 있는 시그니처는 웹 메뉴에도
// 기본 공개(2026-07-15 운영자 결정: "하나씩 켜야 하면 도구가 아니다"),
// 숨김이 필요할 때만 스튜디오에서 끈다.

import type { IncomingMessage, ServerResponse } from "node:http";

import type { PublicSignatureCard, RelaySignatureSyncItem } from "../_webShared.js";
import {
  TABLES,
  THUMB_BUCKET,
  applyCors,
  authenticateRelayDevice,
  decodeThumbBase64,
  handlePreflight,
  readJsonBody,
  sendErr,
  sendOk,
  sendServerError,
  serviceClient
} from "../_webServer.js";

const MEDIA_TYPES: PublicSignatureCard["mediaType"][] = ["image", "gif", "video", "audio"];
const LOCAL_ID_MAX = 200;
const TITLE_MAX = 200;

type ParsedItem = {
  localSignatureId: string;
  title: string;
  amount: number;
  mediaType: PublicSignatureCard["mediaType"];
  thumbBase64: string | null;
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  applyCors(res);
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendErr(res, 405, "method-not-allowed");
    return;
  }

  try {
    const supabase = serviceClient();
    const auth = await authenticateRelayDevice(req, supabase);
    if (!auth.ok) {
      sendErr(res, auth.status, auth.code);
      return;
    }
    const pageId = auth.device.page_id;

    const body = await readJsonBody(req);
    const items = parseItems(body.signatures);
    if (!items) {
      sendErr(res, 400, "validation-failed");
      return;
    }

    const nowIso = new Date().toISOString();

    // 기존 행 목록은 upsert 전에 읽는다 — ①신규/기존 분리(신규만 published=true)
    // ②목록에 없는 기존 행 삭제의 차집합 계산에 함께 쓴다.
    const existingResult = await supabase.from(TABLES.signatures).select("local_signature_id").eq("page_id", pageId);
    if (existingResult.error) {
      throw new Error(existingResult.error.message);
    }
    const existingIds = new Set(
      ((existingResult.data ?? []) as { local_signature_id: string }[]).map((row) => row.local_signature_id)
    );

    // upsert (page_id, local_signature_id 기준) — 목록 순서를 sort 힌트로 쓰지
    // 않는다(sort는 스튜디오 소유). 기존 행은 synced_at만 갱신, 신규 행만
    // published=true를 실어 보낸다(PostgREST 일괄 insert는 행마다 컬럼이 같아야
    // 하므로 두 배치로 나눈다).
    const basePayload = (item: ParsedItem) => ({
      page_id: pageId,
      local_signature_id: item.localSignatureId,
      title: item.title,
      amount: item.amount,
      media_type: item.mediaType,
      synced_at: nowIso
    });
    const knownItems = items.filter((item) => existingIds.has(item.localSignatureId));
    const newItems = items.filter((item) => !existingIds.has(item.localSignatureId));
    if (knownItems.length > 0) {
      const upsertResult = await supabase
        .from(TABLES.signatures)
        .upsert(knownItems.map(basePayload), { onConflict: "page_id,local_signature_id" });
      if (upsertResult.error) {
        throw new Error(upsertResult.error.message);
      }
    }
    if (newItems.length > 0) {
      const insertResult = await supabase.from(TABLES.signatures).upsert(
        newItems.map((item) => ({ ...basePayload(item), published: true })),
        { onConflict: "page_id,local_signature_id" }
      );
      if (insertResult.error) {
        throw new Error(insertResult.error.message);
      }
    }

    // 목록에 없는 기존 행 삭제 — id 이스케이프 문제를 피하려고 JS에서 차집합 계산
    const incomingIds = new Set(items.map((item) => item.localSignatureId));
    const staleIds = [...existingIds].filter((id) => !incomingIds.has(id));
    if (staleIds.length > 0) {
      const deleteResult = await supabase
        .from(TABLES.signatures)
        .delete()
        .eq("page_id", pageId)
        .in("local_signature_id", staleIds);
      if (deleteResult.error) {
        throw new Error(deleteResult.error.message);
      }
      // 고아 썸네일 정리(실패해도 동기화는 계속)
      await supabase.storage
        .from(THUMB_BUCKET)
        .remove(staleIds.map((id) => thumbPath(pageId, id)))
        .catch(() => undefined);
    }

    // 썸네일 업로드: 200KB 초과·비정상 base64는 해당 항목만 스킵 표시
    const thumbSkipped: string[] = [];
    const thumbFailed: string[] = [];
    for (const item of items) {
      if (item.thumbBase64 === null) continue;
      const decoded = decodeThumbBase64(item.thumbBase64);
      if (decoded.kind !== "ok") {
        thumbSkipped.push(item.localSignatureId);
        continue;
      }
      const path = thumbPath(pageId, item.localSignatureId);
      const upload = await supabase.storage.from(THUMB_BUCKET).upload(path, decoded.buffer, {
        contentType: "image/jpeg",
        upsert: true
      });
      if (upload.error) {
        thumbFailed.push(item.localSignatureId);
        continue;
      }
      const publicUrl = supabase.storage.from(THUMB_BUCKET).getPublicUrl(path).data.publicUrl;
      const thumbUpdate = await supabase
        .from(TABLES.signatures)
        // 경로가 고정이라 CDN 캐시 무효화를 위해 버전 쿼리를 붙인다
        .update({ thumb_url: `${publicUrl}?v=${Date.now()}` })
        .eq("page_id", pageId)
        .eq("local_signature_id", item.localSignatureId);
      if (thumbUpdate.error) {
        thumbFailed.push(item.localSignatureId);
      }
    }

    const dirtyResult = await supabase
      .from(TABLES.relayDevices)
      .update({ signatures_dirty: false })
      .eq("id", auth.device.id);
    if (dirtyResult.error) {
      throw new Error(dirtyResult.error.message);
    }

    sendOk(res, {
      upserted: items.length,
      deleted: staleIds.length,
      thumbSkipped,
      thumbFailed
    });
  } catch (error) {
    sendServerError(res, error);
  }
}

function thumbPath(pageId: string, localSignatureId: string): string {
  return `${pageId}/${encodeURIComponent(localSignatureId)}.jpg`;
}

function parseItems(value: unknown): ParsedItem[] | null {
  if (!Array.isArray(value)) return null;
  const items: ParsedItem[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Partial<RelaySignatureSyncItem> & Record<string, unknown>;
    const localSignatureIdValue = record.localSignatureId ?? record.local_signature_id;
    const localSignatureId = typeof localSignatureIdValue === "string" ? localSignatureIdValue.trim() : "";
    const title = typeof record.title === "string" ? record.title.trim().slice(0, TITLE_MAX) : "";
    const amount = typeof record.amount === "number" ? record.amount : Number.NaN;
    const mediaType = record.mediaType ?? record.media_type;
    const thumbValue = record.thumbBase64 ?? record.thumb;
    const thumbBase64 = typeof thumbValue === "string" && thumbValue ? thumbValue : null;
    if (
      !localSignatureId ||
      localSignatureId.length > LOCAL_ID_MAX ||
      seen.has(localSignatureId) ||
      !Number.isInteger(amount) ||
      amount <= 0 ||
      !MEDIA_TYPES.includes(mediaType as PublicSignatureCard["mediaType"])
    ) {
      return null;
    }
    seen.add(localSignatureId);
    items.push({
      localSignatureId,
      title,
      amount,
      mediaType: mediaType as PublicSignatureCard["mediaType"],
      thumbBase64
    });
  }
  return items;
}
