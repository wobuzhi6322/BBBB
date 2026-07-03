import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import {
  EnterpriseHttpError,
  assertNoError,
  requireEnterpriseStreamerScope
} from "./_enterprise-access.js";
import { handleEnterpriseRoute, readJsonBody } from "./_enterprise.js";

type ImportBody = {
  readonly sourceKind?: unknown;
  readonly sourceLabel?: unknown;
  readonly rows?: unknown;
};

type ImportInputRow = {
  readonly rowNumber: number;
  readonly streamerName: string;
  readonly donorName: string;
  readonly amountText: string;
  readonly donatedAtText?: string;
  readonly memo?: string;
  readonly rawText: string;
  readonly externalId?: string;
};

type StreamerRow = {
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

const importsTable = "bbbb_enterprise_donation_imports";
const donationsTable = "bbbb_enterprise_donations";
const streamersTable = "bbbb_enterprise_streamers";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleEnterpriseRoute(req, res, {
    methods: ["GET", "POST"],
    capability: "importBatches",
    run: async ({ method, req: request, url, supabase, access }) => {
      if (method === "GET") {
        const scopedStreamerId = requireEnterpriseStreamerScope(access, normalizeOptionalText(url.searchParams.get("streamerId")));
        const query = supabase
          .from(importsTable)
          .select("id,enterprise_id,source_kind,source_label,status,raw_row_count,imported_row_count,created_at")
          .eq("enterprise_id", access.enterpriseId)
          .order("created_at", { ascending: false });
        if (scopedStreamerId !== null) {
          const directImportsResult = await query.eq("streamer_id", scopedStreamerId);
          assertNoError(directImportsResult.error);
          const donationRefsResult = await supabase
            .from(donationsTable)
            .select("import_id")
            .eq("enterprise_id", access.enterpriseId)
            .eq("streamer_id", scopedStreamerId);
          assertNoError(donationRefsResult.error);
          const donationImportIds = uniqueImportIds(donationRefsResult.data);
          const donationImportsResult = donationImportIds.length === 0
            ? { data: [], error: null }
            : await supabase
              .from(importsTable)
              .select("id,enterprise_id,source_kind,source_label,status,raw_row_count,imported_row_count,created_at")
              .eq("enterprise_id", access.enterpriseId)
              .in("id", donationImportIds)
              .order("created_at", { ascending: false });
          assertNoError(donationImportsResult.error);
          return {
            importBatches: mergeImportRows(directImportsResult.data, donationImportsResult.data)
          };
        }
        const importsResult = await query;
        assertNoError(importsResult.error);
        return { importBatches: importsResult.data ?? [] };
      }

      if (access.role !== "owner" && access.role !== "admin") {
        throw new EnterpriseHttpError(403, "mutation-forbidden");
      }

      const body = parseImportBody(await readJsonBody(request));
      const rows = normalizeRows(body.rows);
      const sourceKind = normalizeSourceKind(body.sourceKind);
      const sourceLabel = normalizeOptionalText(typeof body.sourceLabel === "string" ? body.sourceLabel : null);
      const streamersResult = await supabase
        .from(streamersTable)
        .select("id,display_name")
        .eq("enterprise_id", access.enterpriseId);
      assertNoError(streamersResult.error);
      const streamers = normalizeStreamers(streamersResult.data);
      const batchStreamerId = resolveBatchStreamerId(rows, streamers);
      const importResult = await supabase
        .from(importsTable)
        .insert({
          enterprise_id: access.enterpriseId,
          streamer_id: batchStreamerId,
          source_kind: sourceKind,
          source_label: sourceLabel,
          status: "processing",
          raw_row_count: rows.length,
          imported_row_count: 0,
          created_by: access.userId
        })
        .select("id,enterprise_id,source_kind,source_label,status,raw_row_count,imported_row_count")
        .single();
      assertNoError(importResult.error);
      const importBatchId = requireInsertedId(importResult.data);
      const parsed = parseRows({ enterpriseId: access.enterpriseId, importId: importBatchId, sourceKind, rows, streamers });
      const donationInsertResult = parsed.donationRows.length === 0
        ? { data: [], error: null }
        : await supabase.from(donationsTable).insert(parsed.donationRows).select();
      assertNoError(donationInsertResult.error);
      const donationRows = donationInsertResult.data ?? [];
      const updateResult = await supabase
        .from(importsTable)
        .update({
          streamer_id: batchStreamerId,
          status: "imported",
          raw_row_count: rows.length,
          imported_row_count: donationRows.length
        })
        .eq("id", importBatchId)
        .single();
      assertNoError(updateResult.error);

      return {
        importBatch: {
          ...(updateResult.data ?? importResult.data),
          source_kind: sourceKind,
          source_label: sourceLabel,
          status: "imported",
          raw_row_count: rows.length,
          imported_row_count: donationRows.length
        },
        donationRows,
        rowErrors: parsed.rowErrors
      };
    }
  });
}

function parseRows(input: {
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

function uniqueImportIds(value: unknown): readonly string[] {
  const ids = new Set<string>();
  const rows = Array.isArray(value) ? value : [];
  for (const row of rows) {
    if (isRecord(row) && typeof row.import_id === "string" && row.import_id) {
      ids.add(row.import_id);
    }
  }
  return [...ids];
}

function mergeImportRows(primary: unknown, secondary: unknown): readonly ImportRow[] {
  const rows = new Map<string, ImportRow>();
  for (const row of [...normalizeImportRows(primary), ...normalizeImportRows(secondary)]) {
    rows.set(row.id, row);
  }
  return [...rows.values()].sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")));
}

function normalizeImportRows(value: unknown): readonly ImportRow[] {
  return Array.isArray(value) ? value.filter(isImportRow) : [];
}

function isImportRow(value: unknown): value is ImportRow {
  return isRecord(value) && typeof value.id === "string";
}

function parseImportBody(value: unknown): ImportBody {
  if (!isRecord(value)) {
    throw new EnterpriseHttpError(400, "request body must be an object");
  }
  if (!Array.isArray(value.rows)) {
    throw new EnterpriseHttpError(400, "rows must be an array");
  }
  return {
    sourceKind: value.sourceKind,
    sourceLabel: value.sourceLabel,
    rows: value.rows
  };
}

function normalizeStreamers(value: unknown): readonly StreamerRow[] {
  return Array.isArray(value) ? value.filter(isStreamerRow) : [];
}

function isStreamerRow(value: unknown): value is StreamerRow {
  return isRecord(value) && typeof value.id === "string";
}

function requireInsertedId(value: unknown): string {
  if (isRecord(value) && typeof value.id === "string" && value.id) {
    return value.id;
  }
  throw new EnterpriseHttpError(500, "import-batch-create-failed");
}

function resolveBatchStreamerId(rows: readonly ImportInputRow[], streamers: readonly StreamerRow[]): string | null {
  const streamerIds = new Set<string>();
  for (const row of rows) {
    const streamer = findStreamer(streamers, row.streamerName);
    if (streamer) {
      streamerIds.add(streamer.id);
    }
  }
  return streamerIds.size === 1 ? [...streamerIds][0] ?? null : null;
}

function findStreamer(streamers: readonly StreamerRow[], streamerName: string): StreamerRow | undefined {
  const normalizedName = normalizeLookup(streamerName);
  return streamers.find((candidate) => normalizeLookup(candidate.display_name ?? "") === normalizedName);
}

function normalizeRows(value: unknown): readonly ImportInputRow[] {
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

function normalizeSourceKind(value: unknown): "csv" | "google_sheet" | "manual" {
  return value === "google_sheet" || value === "manual" ? value : "csv";
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
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
