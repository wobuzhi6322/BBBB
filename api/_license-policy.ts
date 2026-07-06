export type LicensePolicyRow = {
  plan?: string | null;
  status?: string | null;
  expires_at?: string | null;
};

export const SUPPORTED_LICENSE_PLANS = ["starter", "standard", "pro"] as const;

const supportedLicensePlanSet = new Set<string>(SUPPORTED_LICENSE_PLANS);

export function isSupportedLicensePlan(plan: unknown): boolean {
  return typeof plan === "string" && supportedLicensePlanSet.has(plan.toLowerCase());
}

export function isUsableLicense(license: LicensePolicyRow | null | undefined, now: Date = new Date()): boolean {
  if (!license || license.status !== "active" || !isSupportedLicensePlan(license.plan)) {
    return false;
  }
  if (!license.expires_at) {
    return true;
  }
  return new Date(license.expires_at).getTime() > now.getTime();
}

export function selectActiveLicenseForAccount<T extends LicensePolicyRow>(licenses: readonly T[], now: Date = new Date()): T | null {
  return licenses.find((license) => isUsableLicense(license, now)) ?? null;
}

export function hasSupportedActiveLicensePlan(licenses: readonly LicensePolicyRow[]): boolean {
  return licenses.some((license) => license.status === "active" && isSupportedLicensePlan(license.plan));
}
