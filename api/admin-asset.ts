import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

import { adminPageSecurityHeaders } from "./_admin-page-security.js";
import { sendNotFound, verifyAdminSession } from "./_admin-session.js";

const allowedFiles: Record<string, string> = {
  "admin.css": "text/css; charset=utf-8",
  "admin-role-state.js": "application/javascript; charset=utf-8",
  "admin.js": "application/javascript; charset=utf-8"
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!["GET", "HEAD"].includes(req.method || "")) {
    res.writeHead(405, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end("method-not-allowed");
    return;
  }

  if (!verifyAdminSession(req)) {
    sendNotFound(res);
    return;
  }

  const url = new URL(req.url || "/api/admin-asset", "https://bbbb.local");
  const file = url.searchParams.get("file") || "";
  const contentType = allowedFiles[file];
  if (!contentType) {
    sendNotFound(res);
    return;
  }

  const content = readFileSync(join(process.cwd(), "admin-private", file), "utf8");
  res.writeHead(200, {
    ...adminPageSecurityHeaders(),
    "content-type": contentType
  });
  res.end(req.method === "HEAD" ? undefined : content);
}
