// POST /api/report — 신고 접수 → bbbb_web_reports(/ops 큐) (WEB_TECH_SPEC §2.1·§5)
// IP는 해시만 저장(원문 미보관). 접수는 202.

import type { IncomingMessage, ServerResponse } from "node:http";

import type { ReportBody } from "./_webShared.js";
import {
  TABLES,
  applyCors,
  clientIp,
  handlePreflight,
  hashIp,
  readJsonBody,
  sendErr,
  sendOk,
  sendServerError,
  serviceClient
} from "./_webServer.js";

const REASON_MAX = 500;
const TARGET_ID_MAX = 200;
const REPORTS_PER_HOUR_PER_IP = 20;
const TARGET_TYPES: ReportBody["targetType"][] = ["page", "signature", "message"];

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  applyCors(res);
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendErr(res, 405, "method-not-allowed");
    return;
  }

  try {
    const body = await readJsonBody(req);
    const targetType = body.targetType;
    const targetId = typeof body.targetId === "string" ? body.targetId.trim() : "";
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";

    if (
      !TARGET_TYPES.includes(targetType as ReportBody["targetType"]) ||
      !targetId ||
      targetId.length > TARGET_ID_MAX ||
      !reason ||
      reason.length > REASON_MAX
    ) {
      sendErr(res, 400, "validation-failed");
      return;
    }

    const supabase = serviceClient();
    const ipHash = hashIp(clientIp(req));

    // 남용 방어: 같은 IP가 (a) 동일 대상을 24h 내 중복 신고하거나 (b) 1시간 내
    // 20건 넘게 신고하면 조용히 접수 처리(202)하되 저장하지 않는다 — /ops 큐 범람과
    // 무한 행 삽입(스토리지·비용)을 막는다. 정상 신고자에겐 동일한 202로 보인다.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    const dup = await supabase
      .from(TABLES.reports)
      .select("id", { count: "exact", head: true })
      .eq("reporter_ip_hash", ipHash)
      .eq("target_id", targetId)
      .gte("created_at", dayAgo);
    if (dup.error) throw new Error(dup.error.message);

    const hourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const flood = await supabase
      .from(TABLES.reports)
      .select("id", { count: "exact", head: true })
      .eq("reporter_ip_hash", ipHash)
      .gte("created_at", hourAgo);
    if (flood.error) throw new Error(flood.error.message);

    if ((dup.count ?? 0) === 0 && (flood.count ?? 0) < REPORTS_PER_HOUR_PER_IP) {
      const insertResult = await supabase.from(TABLES.reports).insert({
        target_type: targetType,
        target_id: targetId,
        reason,
        reporter_ip_hash: ipHash
      });
      if (insertResult.error) {
        throw new Error(insertResult.error.message);
      }
    }
    sendOk(res, { accepted: true }, 202);
  } catch (error) {
    sendServerError(res, error);
  }
}
