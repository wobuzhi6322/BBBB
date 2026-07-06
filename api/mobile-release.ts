import type { IncomingMessage, ServerResponse } from "node:http";

type MobileReleaseManifest = {
  version?: unknown;
  tagName?: unknown;
  name?: unknown;
  fileName?: unknown;
  downloadUrl?: unknown;
  latestDownloadUrl?: unknown;
  publishedAt?: unknown;
  notes?: unknown;
  size?: unknown;
  fileSize?: unknown;
  sha256?: unknown;
};

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  const manifestUrl = process.env.R2_MOBILE_RELEASE_MANIFEST_URL || "https://download.gaeideuk.com/releases/mobile-latest.json";

  try {
    const release = await fetchMobileRelease(manifestUrl);
    sendJson(res, 200, {
      ok: true,
      data: {
        source: release ? "r2" : "none",
        release,
        releasesUrl: release?.downloadUrl || manifestUrl
      }
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      error: error instanceof Error ? error.message : "mobile release lookup failed"
    });
  }
}

async function fetchMobileRelease(manifestUrl: string): Promise<Record<string, unknown> | null> {
  const response = await fetch(manifestUrl, {
    headers: {
      accept: "application/json",
      "user-agent": "gyeideuk-mobile-download-site"
    }
  });
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`mobile manifest lookup failed: ${response.status}`);
  }

  const manifest = (await response.json()) as MobileReleaseManifest;
  const fileName = stringValue(manifest.fileName);
  const downloadUrl = stringValue(manifest.downloadUrl) || stringValue(manifest.latestDownloadUrl) || (fileName ? new URL(fileName, manifestUrl).toString() : undefined);
  if (!downloadUrl) {
    return null;
  }

  const version = stringValue(manifest.version) || versionText(fileName) || versionText(downloadUrl) || "latest";
  const tagName = stringValue(manifest.tagName) || `android-v${version}`;
  const name = stringValue(manifest.name) || `Gyeideuk Companion ${version}`;
  const publishedAt = stringValue(manifest.publishedAt) || new Date().toISOString();
  const assetName = fileName || downloadUrl.split("/").pop() || "Gyeideuk-Companion.apk";
  const assetSize = numberValue(manifest.size) || numberValue(manifest.fileSize) || (await fetchContentLength(downloadUrl)) || 0;
  const asset = {
    name: assetName,
    size: assetSize,
    downloadUrl,
    downloadCount: 0,
    updatedAt: publishedAt
  };

  return {
    tagName,
    name,
    body: stringValue(manifest.notes) || "",
    htmlUrl: downloadUrl,
    publishedAt,
    assets: [asset],
    downloadAsset: asset,
    downloadUrl,
    sha256: stringValue(manifest.sha256),
    hasApkAsset: /\.apk$/i.test(assetName)
  };
}

async function fetchContentLength(url: string): Promise<number | undefined> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    const size = Number.parseInt(response.headers.get("content-length") || "", 10);
    return response.ok && Number.isFinite(size) ? size : undefined;
  } catch {
    return undefined;
  }
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function versionText(value: string | undefined): string | undefined {
  const match = value?.match(/(\d+\.\d+\.\d+|\d+\.\d+)/);
  if (!match) {
    return undefined;
  }
  return match[1].split(".").length === 2 ? `${match[1]}.0` : match[1];
}
