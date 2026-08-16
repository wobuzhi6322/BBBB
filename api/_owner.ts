import { defaultFeatureFlags } from "./_feature-flags.js";

const defaultOwnerUserIds = [
  "49ba6b61-f491-47a5-a687-97dcf4c14b61",
  "fec25c39-3108-4715-a10a-62b41d6df24d"
];
const authUserIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ownerUserIds = new Set(
  (process.env.BBBB_OWNER_USER_IDS || defaultOwnerUserIds.join(","))
    .split(",")
    .map((userId) => userId.trim().toLowerCase())
    .filter((userId) => authUserIdPattern.test(userId))
);

export function isOwnerUserId(value: string | null | undefined): boolean {
  return Boolean(value && ownerUserIds.has(value.trim().toLowerCase()));
}

export function ownerLicense(userId: string, now = new Date().toISOString()) {
  return {
    id: `owner-${userId}`,
    user_id: userId,
    license_code: "GYEIDEUK-OWNER",
    plan: "owner",
    status: "active",
    max_signatures: 999999,
    max_media_mb: 999999,
    max_devices: 999999,
    shared_sync_enabled: true,
    feature_flags: { ...defaultFeatureFlags },
    issued_at: now,
    activated_at: now,
    expires_at: null,
    updated_at: now
  };
}
