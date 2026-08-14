const baseUrl = process.env.TEAM_CODE_BASE_URL || "https://www.gaeideuk.com";
const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const serviceHeaders = {
  apikey: serviceRoleKey,
  authorization: `Bearer ${serviceRoleKey}`
};

const [profilesResponse, versionsResponse] = await Promise.all([
  fetch(`${supabaseUrl}/rest/v1/bbbb_shared_profiles?select=code,latest_version`, {
    headers: serviceHeaders
  }),
  fetch(
    `${supabaseUrl}/rest/v1/bbbb_shared_profile_versions?select=code,version,status,media_files&status=eq.finalized`,
    { headers: serviceHeaders }
  )
]);

const [profiles, versions] = await Promise.all([
  profilesResponse.json(),
  versionsResponse.json()
]);

if (!profilesResponse.ok || !Array.isArray(profiles)) {
  throw new Error(`shared profile query failed (${profilesResponse.status})`);
}
if (!versionsResponse.ok || !Array.isArray(versions)) {
  throw new Error(`shared version query failed (${versionsResponse.status})`);
}

const versionsByKey = new Map(
  versions.map((version) => [`${version.code}:${version.version}`, version])
);
const latestProfiles = profiles
  .map((profile) => {
    const version = versionsByKey.get(`${profile.code}:${profile.latest_version}`);
    return version
      ? {
        code: profile.code,
        version: profile.latest_version,
        mediaCount: Array.isArray(version.media_files) ? version.media_files.length : 0
      }
      : null;
  })
  .filter(Boolean)
  .sort((left, right) => right.mediaCount - left.mediaCount);

const target = latestProfiles[0];
if (!target) {
  throw new Error("no finalized team-code profile is available");
}

const startedAt = Date.now();
const response = await fetch(
  new URL(`/api/shared-profile?code=${encodeURIComponent(target.code)}`, baseUrl),
  { signal: AbortSignal.timeout(65_000) }
);
const elapsedMs = Date.now() - startedAt;
const payload = await response.json().catch(() => null);

if (!response.ok || payload?.ok !== true) {
  throw new Error(`team-code download failed (${response.status}) after ${elapsedMs}ms`);
}
if (elapsedMs > 30_000) {
  throw new Error(`team-code download exceeded 30s (${elapsedMs}ms)`);
}

const downloadTargets = payload?.data?.downloadTargets;
if (!Array.isArray(downloadTargets) || downloadTargets.length !== target.mediaCount) {
  throw new Error("team-code download target count does not match the media manifest");
}

console.log(JSON.stringify({
  ok: true,
  profileCount: latestProfiles.length,
  version: target.version,
  mediaCount: target.mediaCount,
  downloadTargetCount: downloadTargets.length,
  elapsedMs
}));
