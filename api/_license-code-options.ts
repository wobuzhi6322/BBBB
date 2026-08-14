const sharedSyncMarker = /\[\[bbbb-license-code-shared-sync:(true|false)\]\]/i;
const sharedSyncMarkerGlobal = /\s*\[\[bbbb-license-code-shared-sync:(?:true|false)\]\]/gi;

export function notesWithLicenseCodeSharedSync(notes: string | null | undefined, enabled: boolean): string {
  const visibleNotes = stripLicenseCodeSharedSyncFromNotes(notes);
  return [visibleNotes, `[[bbbb-license-code-shared-sync:${enabled}]]`].filter(Boolean).join("\n");
}

export function licenseCodeSharedSyncFromNotes(notes: unknown): boolean | undefined {
  if (typeof notes !== "string") {
    return undefined;
  }
  const match = notes.match(sharedSyncMarker);
  if (!match) {
    return undefined;
  }
  return match[1]?.toLowerCase() === "true";
}

export function resolveLicenseCodeSharedSync(planDefault: boolean, notes: unknown): boolean {
  return licenseCodeSharedSyncFromNotes(notes) ?? planDefault;
}

export function stripLicenseCodeSharedSyncFromNotes(notes: unknown): string | null {
  if (typeof notes !== "string") {
    return null;
  }
  const visibleNotes = notes.replace(sharedSyncMarkerGlobal, "").trim();
  return visibleNotes || null;
}
