import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

type MediaFile = {
  kind: string;
  filename: string;
  size: number;
  updatedAt: string;
  storagePath: string;
};

type ApiBody = {
  action?: string;
  code?: string;
  version?: number;
  bundle?: Record<string, unknown>;
  mediaFiles?: unknown[];
};

const profilesTable = "bbbb_shared_profiles";
const versionsTable = "bbbb_shared_profile_versions";
const storageBucket = process.env.SUPABASE_STORAGE_BUCKET || "bbbb-shared-media";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (req.method === "GET") {
      await handleGet(req, res);
      return;
    }

    if (req.method === "POST") {
      const body = await readJson(req);
      if (body.action === "prepareUpload") {
        assertAdmin(req);
        await handlePrepareUpload(body, res);
        return;
      }
      if (body.action === "finalizeUpload") {
        assertAdmin(req);
        await handleFinalizeUpload(body, res);
        return;
      }
    }

    sendError(res, 404, "not-found");
  } catch (error) {
    sendError(res, 400, error instanceof Error ? error.message : "shared-profile failed");
  }
}

async function handlePrepareUpload(body: ApiBody, res: ServerResponse): Promise<void> {
  const code = normalizeCode(body.code);
  const baseBundle = normalizeBundle(body.bundle);
  const version = await nextVersion(code);
  const mediaFiles = normalizeMediaFiles(body.mediaFiles).map((file) => ({
    ...file,
    storagePath: mediaStoragePath(code, version, file)
  }));
  const bundle = withMediaManifest(baseBundle, mediaFiles);
  const supabase = client();

  await ensureProfile(code);
  const insert = await supabase.from(versionsTable).insert({
    code,
    version,
    status: "prepared",
    bundle,
    media_files: mediaFiles
  });
  if (insert.error) {
    throw new Error(insert.error.message);
  }

  const uploadTargets = [];
  for (const file of mediaFiles) {
    const { data, error } = await supabase.storage.from(storageBucket).createSignedUploadUrl(file.storagePath, { upsert: true });
    if (error || !data) {
      throw new Error(error?.message || `failed to create signed upload url for ${file.filename}`);
    }
    uploadTargets.push({
      ...file,
      signedUrl: data.signedUrl,
      token: data.token
    });
  }

  sendOk(res, {
    code,
    version,
    bundle,
    mediaFiles,
    uploadTargets
  });
}

async function handleFinalizeUpload(body: ApiBody, res: ServerResponse): Promise<void> {
  const code = normalizeCode(body.code);
  const version = normalizeVersion(body.version);
  const now = new Date().toISOString();
  const supabase = client();
  const update = await supabase
    .from(versionsTable)
    .update({ status: "finalized", finalized_at: now })
    .eq("code", code)
    .eq("version", version)
    .eq("status", "prepared")
    .select("bundle, media_files")
    .single();

  if (update.error) {
    throw new Error(update.error.message);
  }

  const upsert = await supabase.from(profilesTable).upsert(
    {
      code,
      latest_version: version,
      updated_at: now
    },
    { onConflict: "code" }
  );
  if (upsert.error) {
    throw new Error(upsert.error.message);
  }

  sendOk(res, {
    code,
    version,
    bundle: update.data.bundle,
    mediaFiles: update.data.media_files
  });
}

async function handleGet(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = requestUrl(req);
  const code = normalizeCode(url.searchParams.get("code"));
  const versionParam = url.searchParams.get("version");
  const supabase = client();
  let query = supabase
    .from(versionsTable)
    .select("code, version, bundle, media_files")
    .eq("code", code)
    .eq("status", "finalized")
    .order("version", { ascending: false })
    .limit(1);

  if (versionParam) {
    query = query.eq("version", normalizeVersion(Number(versionParam)));
  }

  const result = await query;
  if (result.error) {
    throw new Error(result.error.message);
  }
  const row = result.data?.[0];
  if (!row) {
    throw new Error("공유 코드에 확정된 설정이 없습니다.");
  }

  const mediaFiles = normalizeMediaFiles(row.media_files);
  const downloadTargets = [];
  for (const file of mediaFiles) {
    const { data, error } = await supabase.storage.from(storageBucket).createSignedUrl(file.storagePath, 60 * 60);
    if (error || !data) {
      throw new Error(error?.message || `failed to create signed download url for ${file.filename}`);
    }
    downloadTargets.push({
      ...file,
      signedUrl: data.signedUrl
    });
  }

  sendOk(res, {
    code: row.code,
    version: row.version,
    bundle: row.bundle,
    mediaFiles,
    downloadTargets
  });
}

async function ensureProfile(code: string): Promise<void> {
  const now = new Date().toISOString();
  const result = await client().from(profilesTable).upsert(
    {
      code,
      updated_at: now
    },
    { onConflict: "code" }
  );
  if (result.error) {
    throw new Error(result.error.message);
  }
}

async function nextVersion(code: string): Promise<number> {
  const result = await client()
    .from(versionsTable)
    .select("version")
    .eq("code", code)
    .order("version", { ascending: false })
    .limit(1);
  if (result.error) {
    throw new Error(result.error.message);
  }
  return Number(result.data?.[0]?.version || 0) + 1;
}

function client() {
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

function assertAdmin(req: IncomingMessage): void {
  const expected = process.env.BBBB_SHARED_ADMIN_TOKEN;
  const received = req.headers["x-bbbb-admin-token"];
  const token = Array.isArray(received) ? received[0] : received;
  if (!expected || token !== expected) {
    throw new Error("관리자 토큰이 올바르지 않습니다.");
  }
}

async function readJson(req: IncomingMessage): Promise<ApiBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as ApiBody;
}

function normalizeBundle(input: unknown): Record<string, unknown> {
  if (!isRecord(input)) {
    throw new Error("bundle is required");
  }
  return input;
}

function withMediaManifest(bundle: Record<string, unknown>, mediaFiles: MediaFile[]): Record<string, unknown> {
  const mediaAssets = isRecord(bundle.mediaAssets) ? bundle.mediaAssets : {};
  return {
    ...bundle,
    mediaAssets: {
      ...mediaAssets,
      files: mediaFiles
    }
  };
}

function normalizeMediaFiles(input: unknown): MediaFile[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map(normalizeMediaFile);
}

function normalizeMediaFile(input: unknown): MediaFile {
  if (!isRecord(input)) {
    throw new Error("invalid media file");
  }
  const kind = stringValue(input.kind);
  const filename = stringValue(input.filename);
  const size = numberValue(input.size);
  const updatedAt = stringValue(input.updatedAt);
  const storagePath = stringValue(input.storagePath);
  if (!kind || !["images", "sounds", "videos", "wallpapers"].includes(kind)) {
    throw new Error("invalid media kind");
  }
  if (!filename || path.basename(filename) !== filename || filename.includes("..")) {
    throw new Error("invalid media filename");
  }
  if (size === undefined || size < 0 || !updatedAt) {
    throw new Error("invalid media metadata");
  }
  return {
    kind,
    filename,
    size,
    updatedAt,
    storagePath: storagePath || ""
  };
}

function mediaStoragePath(code: string, version: number, file: Pick<MediaFile, "kind" | "filename" | "size" | "updatedAt">): string {
  return `${code}/v${version}/${file.kind}/${safeStorageFilename(file)}`;
}

function safeStorageFilename(file: Pick<MediaFile, "kind" | "filename" | "size" | "updatedAt">): string {
  const ext = safeExtension(path.extname(file.filename));
  const base = path
    .basename(file.filename, path.extname(file.filename))
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const hash = createHash("sha256")
    .update(`${file.kind}/${file.filename}/${file.size}/${file.updatedAt}`)
    .digest("hex")
    .slice(0, 16);
  return `${base || "asset"}-${hash}${ext}`;
}

function safeExtension(ext: string): string {
  const normalized = ext.toLowerCase().replace(/[^a-z0-9.]/g, "");
  if (!normalized || normalized === ".") {
    return "";
  }
  return normalized.slice(0, 16);
}

function normalizeCode(input: unknown): string {
  const code = stringValue(input)?.toUpperCase();
  if (!code || !/^[A-Z0-9][A-Z0-9-]{2,63}$/.test(code)) {
    throw new Error("공유 코드는 영문 대문자, 숫자, 하이픈 3~64자로 입력하세요.");
  }
  return code;
}

function normalizeVersion(input: unknown): number {
  const version = numberValue(input);
  if (!version || !Number.isInteger(version) || version <= 0) {
    throw new Error("version is required");
  }
  return version;
}

function requestUrl(req: IncomingMessage): URL {
  const host = req.headers.host ?? "localhost";
  return new URL(req.url ?? "/", `https://${host}`);
}

function sendOk(res: ServerResponse, data: unknown): void {
  sendJson(res, 200, { ok: true, data });
}

function sendError(res: ServerResponse, status: number, error: string): void {
  sendJson(res, status, { ok: false, error });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,x-bbbb-admin-token"
  });
  res.end(JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,x-bbbb-admin-token");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
