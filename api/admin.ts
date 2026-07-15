import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!["GET", "HEAD"].includes(req.method || "")) {
    res.writeHead(405, {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end("method-not-allowed");
    return;
  }

  const html = readFileSync(join(process.cwd(), "admin-private", "index.html"), "utf8");
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(req.method === "HEAD" ? undefined : html);
}
