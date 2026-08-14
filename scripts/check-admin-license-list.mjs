const baseUrl = process.env.ADMIN_BASE_URL || "https://www.gaeideuk.com";
const accessToken = process.env.ADMIN_ACCESS_TOKEN;
const adminToken = process.env.BBBB_SHARED_ADMIN_TOKEN;

if (!accessToken && !adminToken) {
  throw new Error("ADMIN_ACCESS_TOKEN or BBBB_SHARED_ADMIN_TOKEN is required");
}

const headers = accessToken
  ? { authorization: `Bearer ${accessToken}` }
  : { "x-bbbb-admin-token": adminToken };

const response = await fetch(new URL("/api/admin-license", baseUrl), { headers });
const payload = await response.json();

if (!response.ok || payload?.ok !== true) {
  throw new Error(`admin-license list failed (${response.status}): ${payload?.error || "unknown-error"}`);
}

const profiles = payload?.data?.profiles;
if (!Array.isArray(profiles) || profiles.length === 0) {
  throw new Error("admin-license list returned no profiles");
}

const emailCount = profiles.filter(
  (profile) => typeof profile?.email === "string" && profile.email.length > 0
).length;

if (emailCount === 0) {
  throw new Error("admin-license list returned no member emails");
}

console.log(JSON.stringify({
  ok: true,
  profileCount: profiles.length,
  emailCount
}));
