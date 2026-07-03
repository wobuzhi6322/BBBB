import type { IncomingMessage, ServerResponse } from "node:http";

import {
  EnterpriseHttpError,
  createEnterpriseAccess,
  serviceClient
} from "./_enterprise-access.js";

type EnterpriseMethod = "GET" | "POST";

type EnterpriseRouteOptions = {
  readonly methods: readonly EnterpriseMethod[];
  readonly capability: "summary" | "streamers" | "importBatches" | "donationRecords" | "writeImports" | "manageStreamers";
  readonly run: (input: {
    readonly req: IncomingMessage;
    readonly method: EnterpriseMethod;
    readonly url: URL;
    readonly supabase: ReturnType<typeof serviceClient>;
    readonly access: Awaited<ReturnType<typeof createEnterpriseAccess>>;
  }) => Promise<unknown>;
};

const maxJsonBodyBytes = 1_000_000;
const enterpriseIdPattern = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|[a-z0-9][a-z0-9_-]{0,127})$/iu;

export async function handleEnterpriseRoute(
  req: IncomingMessage,
  res: ServerResponse,
  options: EnterpriseRouteOptions
): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  try {
    const method = normalizeMethod(req.method);
    if (!options.methods.includes(method)) {
      throw new EnterpriseHttpError(405, "method-not-allowed");
    }

    const url = new URL(req.url ?? "/", `http://${headerValue(req.headers.host) ?? "localhost"}`);
    const enterpriseId = parseEnterpriseId(normalizeRequiredText(url.searchParams.get("enterpriseId"), "enterpriseId is required"));
    const supabase = serviceClient();
    const access = await createEnterpriseAccess({
      req,
      supabase,
      enterpriseId,
      capability: options.capability,
      method
    });
    const data = await options.run({ req, method, url, supabase, access });
    sendJson(res, 200, { ok: true, data });
  } catch (error) {
    if (error instanceof EnterpriseHttpError) {
      sendJson(res, error.status, { ok: false, error: error.message });
      return;
    }
    sendJson(res, 500, { ok: false, error: "enterprise-api-failed" });
  }
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > maxJsonBodyBytes) {
      throw new EnterpriseHttpError(413, "request-body-too-large");
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new EnterpriseHttpError(400, "invalid-json");
    }
    throw error;
  }
}

export function normalizeRequiredText(value: string | null, message: string): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) {
    throw new EnterpriseHttpError(400, message);
  }
  return normalized;
}

export function parseEnterpriseId(enterpriseId: string): string {
  if (!enterpriseIdPattern.test(enterpriseId)) {
    throw new EnterpriseHttpError(400, "enterpriseId format is invalid");
  }
  return enterpriseId;
}

function normalizeMethod(value: string | undefined): EnterpriseMethod {
  if (value === "GET" || value === "POST") {
    return value;
  }
  throw new EnterpriseHttpError(405, "method-not-allowed");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "authorization,content-type"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "authorization,content-type");
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
