import type { IncomingMessage, ServerResponse } from "node:http";

type GithubAsset = {
  name?: unknown;
  size?: unknown;
  browser_download_url?: unknown;
  download_count?: unknown;
  updated_at?: unknown;
};

type GithubRelease = {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
  zipball_url?: unknown;
  assets?: unknown;
  draft?: unknown;
  prerelease?: unknown;
};

type ReleaseAsset = {
  name: string;
  size: number;
  downloadUrl: string;
  downloadCount: number;
  updatedAt: string;
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

  const repo = process.env.GITHUB_REPO || "wobuzhi6322/BBBB";
  const apiUrl = `https://api.github.com/repos/${repo}/releases?per_page=30`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "bbbb-download-site"
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  try {
    const response = await fetch(apiUrl, { headers });
    if (response.status === 404) {
      sendNoRelease(res, repo);
      return;
    }
    if (!response.ok) {
      throw new Error(`GitHub release lookup failed: ${response.status}`);
    }

    const releases = (await response.json()) as GithubRelease[];
    const release = pickLatestRelease(releases);
    if (!release) {
      sendNoRelease(res, repo);
      return;
    }
    const assets = normalizeAssets(release.assets);
    const installerAsset = pickInstallerAsset(assets);
    const tagName = stringValue(release.tag_name) || "latest";
    const releaseName = stringValue(release.name) || tagName;
    const displayVersion = preferredDisplayVersion(installerAsset?.name, tagName, releaseName);
    const displayTagName = displayVersion ? `v${displayVersion}` : tagName;
    const sourceZipUrl = stringValue(release.zipball_url) || `https://github.com/${repo}/archive/refs/tags/${encodeURIComponent(tagName)}.zip`;

    sendJson(res, 200, {
      ok: true,
      data: {
        repo,
        release: {
          tagName: displayTagName,
          githubTagName: tagName,
          name: displayVersion && displayTagName !== tagName ? `BBBB Donation Signature ${displayTagName}` : releaseName,
          body: stringValue(release.body) || "",
          htmlUrl: stringValue(release.html_url) || `https://github.com/${repo}/releases/latest`,
          publishedAt: stringValue(release.published_at) || "",
          assets,
          downloadAsset: installerAsset,
          downloadUrl: installerAsset?.downloadUrl || sourceZipUrl,
          sourceZipUrl,
          hasInstallerAsset: Boolean(installerAsset)
        },
        releasesUrl: `https://github.com/${repo}/releases`
      }
    });
  } catch (error) {
    sendJson(res, 502, {
      ok: false,
      error: error instanceof Error ? error.message : "release lookup failed"
    });
  }
}

function sendNoRelease(res: ServerResponse, repo: string): void {
  sendJson(res, 200, {
    ok: true,
    data: {
      repo,
      release: null,
      releasesUrl: `https://github.com/${repo}/releases`,
      message: "아직 GitHub Release가 없습니다."
    }
  });
}

function pickLatestRelease(input: GithubRelease[]): GithubRelease | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const releases = input.filter((release) => release.draft !== true && release.prerelease !== true);
  const sorted = releases.sort(compareReleasesDesc);
  return sorted.find((release) => pickInstallerAsset(normalizeAssets(release.assets))) || sorted[0];
}

function compareReleasesDesc(left: GithubRelease, right: GithubRelease): number {
  const leftVersion = versionParts(stringValue(left.tag_name) || stringValue(left.name));
  const rightVersion = versionParts(stringValue(right.tag_name) || stringValue(right.name));
  const versionCompare = compareVersionParts(leftVersion, rightVersion);
  if (versionCompare !== 0) {
    return -versionCompare;
  }

  const leftTime = dateMs(left.published_at);
  const rightTime = dateMs(right.published_at);
  return rightTime - leftTime;
}

function versionParts(value: string | undefined): number[] {
  const match = value?.match(/v?(\d+(?:\.\d+){0,3})/i);
  if (!match) {
    return [];
  }
  const parts = match[1].split(".").slice(0, 3).map((part) => Number.parseInt(part, 10));
  while (parts.length < 3) {
    parts.push(0);
  }
  return parts.some((part) => !Number.isFinite(part)) ? [] : parts;
}

function versionText(value: string | undefined): string | undefined {
  const match = value?.match(/v?(\d+(?:\.\d+){0,3})/i);
  return match?.[1];
}

function preferredDisplayVersion(assetName: string | undefined, tagName: string, releaseName: string): string | undefined {
  const assetVersion = versionText(assetName);
  const releaseVersion = versionText(tagName) || versionText(releaseName);
  if (!assetVersion) {
    return releaseVersion;
  }
  if (!releaseVersion || compareVersionParts(versionParts(assetVersion), versionParts(releaseVersion)) > 0) {
    return assetVersion;
  }
  return releaseVersion;
}

function compareVersionParts(left: number[], right: number[]): number {
  if (!left.length && !right.length) {
    return 0;
  }
  if (!left.length) {
    return -1;
  }
  if (!right.length) {
    return 1;
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) {
      return difference > 0 ? 1 : -1;
    }
  }
  return 0;
}

function dateMs(value: unknown): number {
  const time = typeof value === "string" ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : 0;
}

function normalizeAssets(input: unknown): ReleaseAsset[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((asset) => {
      const item = asset as GithubAsset;
      return {
        name: stringValue(item.name) || "",
        size: numberValue(item.size) || 0,
        downloadUrl: stringValue(item.browser_download_url) || "",
        downloadCount: numberValue(item.download_count) || 0,
        updatedAt: stringValue(item.updated_at) || ""
      };
    })
    .filter((asset) => asset.name && asset.downloadUrl);
}

function pickInstallerAsset(assets: ReleaseAsset[]): ReleaseAsset | undefined {
  const setupExeAssets = assets.filter((asset) => /\.exe$/i.test(asset.name) && /setup|installer|install/i.test(asset.name));
  const exeAssets = assets.filter((asset) => /\.exe$/i.test(asset.name));
  const msiAssets = assets.filter((asset) => /\.msi$/i.test(asset.name));
  const zipAssets = assets.filter((asset) => /\.zip$/i.test(asset.name));
  return (
    setupExeAssets.find((asset) => /gyeideuk|bbbb|donation|signature|windows|win/i.test(asset.name)) ||
    setupExeAssets[0] ||
    msiAssets.find((asset) => /gyeideuk|bbbb|donation|signature|windows|win/i.test(asset.name)) ||
    msiAssets[0] ||
    exeAssets.find((asset) => /gyeideuk|bbbb|donation|signature|windows|win/i.test(asset.name)) ||
    exeAssets[0] ||
    zipAssets.find((asset) => /gyeideuk|bbbb|donation|signature|windows|win/i.test(asset.name)) ||
    zipAssets[0] ||
    assets[0]
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store, max-age=0",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}
