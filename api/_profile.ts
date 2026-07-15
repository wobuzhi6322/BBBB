export type ChannelPlatform = "youtube" | "instagram" | "tiktok";

export type ProfilePatchBody = {
  channelPlatform?: unknown;
  channelName?: unknown;
  channelUrl?: unknown;
};

export const profileSelect =
  "user_id,email,display_name,role,channel_platform,channel_name,channel_url,trial_started_at,trial_license_id,created_at,updated_at";

export function normalizeChannelPlatform(value: unknown): ChannelPlatform {
  const platform = stringValue(value)?.toLowerCase();
  return platform === "instagram" || platform === "tiktok" || platform === "youtube" ? platform : "youtube";
}

export function normalizeChannelName(value: unknown): string | null {
  return stringValue(value)?.slice(0, 120) || null;
}

export function normalizeChannelUrl(value: unknown): string | null {
  const raw = stringValue(value);
  if (!raw) {
    return null;
  }
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(withProtocol);
    if (!["http:", "https:"].includes(url.protocol)) {
      return null;
    }
    url.hash = "";
    return url.toString().slice(0, 500);
  } catch {
    return null;
  }
}

export function profilePatchFromBody(body: ProfilePatchBody): {
  channel_platform: ChannelPlatform;
  channel_name: string | null;
  channel_url: string | null;
  updated_at: string;
} {
  return {
    channel_platform: normalizeChannelPlatform(body.channelPlatform),
    channel_name: normalizeChannelName(body.channelName),
    channel_url: normalizeChannelUrl(body.channelUrl),
    updated_at: new Date().toISOString()
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
