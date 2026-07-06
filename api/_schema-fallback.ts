export function isMissingFeatureFlagsColumn(error: { message?: string } | null | undefined): boolean {
  const message = error?.message || "";
  return /feature_flags/i.test(message) && /(does not exist|could not find|schema cache|column)/i.test(message);
}

export function withoutFeatureFlags<T extends Record<string, unknown>>(payload: T): Omit<T, "feature_flags"> {
  const { feature_flags: _featureFlags, ...rest } = payload;
  return rest;
}
