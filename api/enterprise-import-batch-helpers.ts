import { createHash } from "node:crypto";

import { EnterpriseHttpError } from "./_enterprise-access.js";

export type ImportInputRow = {
  readonly rowNumber: number;
  readonly streamerName: string;
  readonly donorName: string;
  readonly amountText: string;
  readonly donatedAtText?: string;
  readonly memo?: string;
  readonly rawText: string;
  readonly externalId?: string;
};

export type StreamerRow = {
  readonly id: string;
  readonly display_name?: string | null;
};

type ImportRow = {
  readonly id: string;
  readonly created_at?: string | null;
};

type RowError = {
  readonly rowNumber: number;
  readonly reason: "invalid_amount" | "invalid_date" | "missing_donor" | "missing_streamer";
};

export function parseRows(input: {
  readonly enterpriseId: string;
  readonly importId: string;
  readonly sourceKind: string;
  readonly rows: readonly ImportInputRow[];
  readonly streamers: readonly StreamerRow[];
}) {
  const donationRows: Record<string, unknown>[] = [];
  const rowErrors: RowError[] = [];

  for (const row of input.rows) {
    const streamer = findStreamer(input.streamers, row.streamerName);
    const donorName = row.donorName.trim();
    const amountKrw = parseWonAmount(row.amountText);
    const donatedOn = parseDonationDate(row.donatedAtText);
    if (!streamer) {
      rowErrors.push({ rowNumber: row.rowNumber, reason: "missing_streamer" });
      continue;
    }
    if (!donorName) {
      rowErrors.push({ rowNumber: row.rowNumber, reason: "missing_donor" });
      continue;
    }
    if (amountKrw === null) {
      rowErrors.push({ rowNumber: row.rowNumber, reason: "invalid_amount" });
      continue;
    }
    if (donatedOn === null) {
      rowErrors.push({ rowNumber: row.rowNumber, reason: "invalid_date" });
      continue;
    }

    const rowHash = sha256([streamer.id, donorName, String(amountKrw), donatedOn, row.rawText]);
    const idempotencyKey = buildIdempotencyKey(input.enterpriseId, input.importId, input.sourceKind, row.externalId, rowHash);
    donationRows.push({
      enterprise_id: input.enterpriseId,
      streamer_id: streamer.id,
      import_id: input.importId,
      donor_name: donorName,
      donor_key: normalizeLookup(donorName),
      amount_krw: amountKrw,
      donated_on: donatedOn,
      source_row_hash: idempotencyKey,
      raw_payload: {
        rowNumber: row.rowNumber,
        rawText: row.rawText,
        idempotencyKey,
        ...(row.externalId ? { externalId: row.externalId } : {})
      }
    });
  }

  return { donationRows, rowErrors };
}

export function uniqueImportIds(value: unknown): readonly string[] {
  const ids = new Set<string>();
  const rows = Array.isArray(value) ? value : [];
  for (const row of rows) {
    if (isRecord(row) && typeof row.import_id === "string" && row.import_id) {
      ids.add(row.import_id);
    }
  }
  return [...ids];
}

export function mergeImportRows(primary: unknown, secondary: unknown): readonly ImportRow[] {
  const rows = new Map<string, ImportRow>();
  for (const row of [...normalizeImportRows(primary), ...normalizeImportRows(secondary)]) {
    rows.set(row.id, row);
  }
  return [...rows.values()].sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
}

export function normalizeStreamers(value: unknown): readonly StreamerRow[] {
  return Array.isArray(value) ? value.filter(isStreamerRow) : [];
}

export function requireInsertedId(value: unknown): string {
  if (isRecord(value) && typeof value.id === "string" && value.id) {
    return value.id;
  }
  throw new EnterpriseHttpError(500, "import-batch-create-failed");
}

export function resolveBatchStreamerId(rows: readonly ImportInputRow[], streamers: readonly StreamerRow[]): string | null {
  const streamerIds = new Set<string>();
  for (const row of rows) {
    const streamer = findStreamer(streamers, row.streamerName);
    if (streamer) {
      streamerIds.add(streamer.id);
    }
  }
  return streamerIds.size === 1 ? [...streamerIds][0] ?? null : null;
}

export function normalizeRows(value: unknown): readonly ImportInputRow[] {
  if (!Array.isArray(value)) {
    throw new EnterpriseHttpError(400, "rows must be an array");
  }
  if (value.length === 0) {
    throw new EnterpriseHttpError(400, "rows must not be empty");
  }
  return value.map((row) => {
    if (!isImportInputRow(row)) {
      throw new EnterpriseHttpError(400, "row is malformed");
    }
    return row;
  });
}

function normalizeImportRows(value: unknown): readonly ImportRow[] {
  return Array.isArray(value) ? value.filter(isImportRow) : [];
}

function isImportRow(value: unknown): value is ImportRow {
  return isRecord(value) && typeof value.id === "string";
}

function isStreamerRow(value: unknown): value is StreamerRow {
  return isRecord(value) && typeof value.id === "string";
}

function findStreamer(streamers: readonly StreamerRow[], streamerName: string): StreamerRow | undefined {
  const normalizedName = normalizeLookup(streamerName);
  return streamers.find((candidate) => normalizeLookup(candidate.display_name ?? "") === normalizedName);
}

function isImportInputRow(value: unknown): value is ImportInputRow {
  if (!isRecord(value)) {
    return false;
  }
  return Number.isInteger(value.rowNumber)
    && typeof value.streamerName === "string"
    && typeof value.donorName === "string"
    && typeof value.amountText === "string"
    && typeof value.rawText === "string"
    && isOptionalString(value.donatedAtText)
    && isOptionalString(value.memo)
    && isOptionalString(value.externalId);
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function parseWonAmount(amountText: string): number | null {
  const digits = amountText.replace(/[,\s원₩]/gu, "");
  if (!/^\d+$/u.test(digits)) {
    return null;
  }
  const amount = Number.parseInt(digits, 10);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function parseDonationDate(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(trimmed);
  if (!match) {
    return null;
  }
  const year = Number.parseInt(match[1] ?? "", 10);
  const month = Number.parseInt(match[2] ?? "", 10);
  const day = Number.parseInt(match[3] ?? "", 10);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) {
    return null;
  }
  return trimmed;
}

function buildIdempotencyKey(enterpriseId: string, importId: string, sourceKind: string, externalId: string | undefined, rowHash: string): string {
  const normalizedExternalId = externalId?.trim();
  if (normalizedExternalId) {
    return `${enterpriseId}:${sourceKind}:${sha256([normalizedExternalId])}`;
  }
  return `${enterpriseId}:${importId}:${rowHash}`;
}

function normalizeLookup(value: string): string {
  return value.trim().toLowerCase();
}

function sha256(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part);
    hash.update("\u001f");
  }
  return hash.digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
