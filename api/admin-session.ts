import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { clearAdminSessionCookie, issueAdminSessionCookie, sendJson } from "./_admin-session.js";
import { isOwnerEmail } from "./_owner.js";

const profilesTable = "bbbb_site_profiles";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method === "DELETE") {
    res.setHeader("set-cookie", clearAdminSessionCookie(req));
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  try {
    const token = bearerToken(req);
    if (!token) {
      sendJson(res, 401, { ok: false, error: "login-required" });
      return;
    }

    const supabase = serviceClient();
    const userResult = await supabase.auth.getUser(token);
    const user = userResult.data.user;
    if (userResult.error || !user) {
      sendJson(res, 401, { ok: false, error: "invalid-session" });
      return;
    }

    const isAdmin = isOwnerEmail(user.email) || (await hasAdminRole(supabase, user.id));
    if (!isAdmin) {
      sendJson(res, 403, { ok: false, error: "admin-required" });
      return;
    }

    res.setHeader("set-cookie", issueAdminSessionCookie(req, { id: user.id, email: user.email || null }));
    sendJson(res, 200, { ok: true, data: { expiresInSeconds: 900 } });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "admin-session-failed" });
  }
}

async function hasAdminRole(supabase: ReturnType<typeof serviceClient>, userId: string): Promise<boolean> {
  const result = await supabase.from(profilesTable).select("role").eq("user_id", userId).single();
  return !result.error && result.data?.role === "admin";
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
