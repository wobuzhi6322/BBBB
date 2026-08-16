import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { AdminRequestError, assertAdminOrigin, requireAdminUser } from "./_admin-auth.js";
import { clearAdminSessionCookie, issueAdminSessionCookie, sendJson } from "./_admin-session.js";
import { isOwnerUserId } from "./_owner.js";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    assertAdminOrigin(req);
    if (req.method === "OPTIONS") {
      sendJson(res, 204, {});
      return;
    }

    if (req.method === "DELETE") {
      res.setHeader("set-cookie", clearAdminSessionCookie(req));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET") {
      const principal = await requireAdminUser(req, serviceClient());
      sendJson(res, 200, {
        ok: true,
        data: {
          userId: principal.userId,
          canManageAdminRoles: isOwnerUserId(principal.userId)
        }
      });
      return;
    }

    if (req.method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method-not-allowed" });
      return;
    }

    const principal = await requireAdminUser(req, serviceClient());
    res.setHeader("set-cookie", issueAdminSessionCookie(req, { id: principal.userId }));
    sendJson(res, 200, { ok: true, data: { expiresInSeconds: 900 } });
  } catch (error) {
    if (error instanceof AdminRequestError) {
      sendJson(res, error.status, { ok: false, error: error.message, code: error.code });
      return;
    }
    sendJson(res, 500, { ok: false, error: "admin-session-failed" });
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
