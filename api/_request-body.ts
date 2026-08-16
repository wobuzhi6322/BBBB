import type { IncomingMessage } from "node:http";

export const defaultJsonBodyLimitBytes = 64 * 1024;

type RequestBodyFailure = {
  readonly status: 400 | 413;
  readonly code: "invalid-json" | "payload-too-large";
  readonly message: string;
};

export class RequestBodyError extends Error {
  readonly status: 400 | 413;
  readonly code: RequestBodyFailure["code"];

  constructor(failure: RequestBodyFailure) {
    super(failure.message);
    this.name = "RequestBodyError";
    this.status = failure.status;
    this.code = failure.code;
  }
}

export async function readJsonObject(
  req: IncomingMessage,
  maxBytes = defaultJsonBodyLimitBytes
): Promise<Record<string, unknown>> {
  rejectOversizedContentLength(req, maxBytes);

  const preloadedBody: unknown = Reflect.get(req, "body");
  if (preloadedBody !== undefined) {
    return parsePreloadedBody(preloadedBody, maxBytes);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > maxBytes) {
      throw payloadTooLarge();
    }
    chunks.push(bytes);
  }

  if (!chunks.length) {
    return {};
  }

  return parseJsonBytes(Buffer.concat(chunks), maxBytes);
}

function parsePreloadedBody(value: unknown, maxBytes: number): Record<string, unknown> {
  if (typeof value === "string" || Buffer.isBuffer(value)) {
    return parseJsonBytes(Buffer.from(value), maxBytes);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidJson();
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw invalidJson();
  }
  if (Buffer.byteLength(serialized, "utf8") > maxBytes) {
    throw payloadTooLarge();
  }
  return value as Record<string, unknown>;
}

function parseJsonBytes(bytes: Buffer, maxBytes: number): Record<string, unknown> {
  if (bytes.length > maxBytes) {
    throw payloadTooLarge();
  }

  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw invalidJson();
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidJson();
  }
  return value as Record<string, unknown>;
}

function rejectOversizedContentLength(req: IncomingMessage, maxBytes: number): void {
  const rawValue = headerValue(req.headers["content-length"]);
  if (!rawValue) {
    return;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw invalidJson();
  }
  if (Number(rawValue) > maxBytes) {
    throw payloadTooLarge();
  }
}

function invalidJson(): RequestBodyError {
  return new RequestBodyError({
    status: 400,
    code: "invalid-json",
    message: "요청 본문은 JSON 객체여야 합니다."
  });
}

function payloadTooLarge(): RequestBodyError {
  return new RequestBodyError({
    status: 413,
    code: "payload-too-large",
    message: "요청 본문이 허용 크기를 초과했습니다."
  });
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
