const defaultOwnerEmails = ["wobuzhi6322@gmail.com"];

const ownerEmails = new Set(
  (process.env.BBBB_OWNER_EMAILS || defaultOwnerEmails.join(","))
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean)
);

export function isOwnerEmail(value: string | null | undefined): boolean {
  return Boolean(value && ownerEmails.has(value.trim().toLowerCase()));
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
    issued_at: now,
    activated_at: now,
    expires_at: null,
    updated_at: now
  };
}
