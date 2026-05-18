import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

type DownloadEventBody = {
  releaseTag?: unknown;
  assetName?: unknown;
  assetUrl?: unknown;
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  const body = await readJson(req);
  const releaseTag = stringValue(body.releaseTag) || "unknown";
  const assetName = stringValue(body.assetName) || "unknown";
  const assetUrl = stringValue(body.assetUrl) || "";
  const token = bearerToken(req);
  const supabase = serviceClient();
  if (!supabase) {
    sendJson(res, 200, { ok: true, data: { logged: false, reason: "supabase-not-configured" } });
    return;
  }

  let userId: string | null = null;
  if (token) {
    const user = await supabase.auth.getUser(token);
    userId = user.data.user?.id || null;
  }

  const insert = await supabase.from("bbbb_download_events").insert({
    user_id: userId,
    release_tag: releaseTag,
    asset_name: assetName,
    asset_url: assetUrl,
    user_agent: headerValue(req.headers["user-agent"])
  });

  if (insert.error) {
    sendJson(res, 200, { ok: true, data: { logged: false, reason: insert.error.message } });
    return;
  }

  sendJson(res, 200, { ok: true, data: { logged: true } });
}

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return null;
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

async function readJson(req: IncomingMessage): Promise<DownloadEventBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as DownloadEventBody;
}

function bearerToken(req: IncomingMessage): string | undefined {
  const value = headerValue(req.headers.authorization);
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 2048) : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}
