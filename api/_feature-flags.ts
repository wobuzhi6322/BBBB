export type FeatureFlags = {
  signatures: boolean;
  wallpapers: boolean;
  tagBattle: boolean;
  chatRace: boolean;
  manualOverlays: boolean;
};

export const defaultFeatureFlags: FeatureFlags = {
  signatures: true,
  wallpapers: true,
  tagBattle: true,
  chatRace: true,
  manualOverlays: true
};

const featureKeys = Object.keys(defaultFeatureFlags) as Array<keyof FeatureFlags>;

export function normalizeFeatureFlags(input: unknown): FeatureFlags {
  const record = isRecord(input) ? input : {};
  return featureKeys.reduce<FeatureFlags>(
    (flags, key) => ({
      ...flags,
      [key]: typeof record[key] === "boolean" ? record[key] : defaultFeatureFlags[key]
    }),
    { ...defaultFeatureFlags }
  );
}

const notesMarkerPattern = /(?:\r?\n)?\[BBBB_FEATURE_FLAGS:([A-Za-z0-9+/=]+)\]/;

export function normalizeFeatureFlagsWithNotes(input: unknown, notes: unknown): FeatureFlags {
  return isRecord(input) ? normalizeFeatureFlags(input) : featureFlagsFromNotes(notes) || { ...defaultFeatureFlags };
}

export function notesWithFeatureFlags(notes: unknown, flags: unknown): string {
  const cleanNotes = stripFeatureFlagsFromNotes(notes);
  const encoded = Buffer.from(JSON.stringify(normalizeFeatureFlags(flags)), "utf8").toString("base64");
  return [cleanNotes, `[BBBB_FEATURE_FLAGS:${encoded}]`].filter(Boolean).join("\n");
}

export function stripFeatureFlagsFromNotes(notes: unknown): string | null {
  const value = typeof notes === "string" ? notes : "";
  const clean = value.replace(notesMarkerPattern, "").trim();
  return clean || null;
}

function featureFlagsFromNotes(notes: unknown): FeatureFlags | undefined {
  const value = typeof notes === "string" ? notes : "";
  const match = value.match(notesMarkerPattern);
  if (!match) {
    return undefined;
  }
  try {
    return normalizeFeatureFlags(JSON.parse(Buffer.from(match[1], "base64").toString("utf8")));
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
