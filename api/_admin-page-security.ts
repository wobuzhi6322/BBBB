const adminScriptOrigin = "https://cdn.jsdelivr.net";
const adminStyleOrigins = [
  "'self'",
  "'unsafe-inline'",
  "https://fonts.googleapis.com",
  "https://cdn.jsdelivr.net"
] as const;
const adminFontOrigins = [
  "'self'",
  "data:",
  "https://fonts.gstatic.com",
  "https://cdn.jsdelivr.net"
] as const;

export function adminPageSecurityHeaders(): Record<string, string> {
  const connectSources = ["'self'"];
  const supabaseOrigin = configuredSupabaseOrigin();
  if (supabaseOrigin) {
    connectSources.push(supabaseOrigin);
  }

  return {
    "cache-control": "no-store",
    "content-security-policy": [
      "default-src 'none'",
      `script-src 'self' ${adminScriptOrigin}`,
      `style-src ${adminStyleOrigins.join(" ")}`,
      `font-src ${adminFontOrigins.join(" ")}`,
      "img-src 'self' data: blob:",
      `connect-src ${connectSources.join(" ")}`,
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'"
    ].join("; "),
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  };
}

function configuredSupabaseOrigin(): string | null {
  const value = process.env.SUPABASE_URL;
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
