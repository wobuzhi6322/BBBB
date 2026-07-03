import type { IncomingMessage, ServerResponse } from "node:http";

import {
  EnterpriseHttpError,
  assertNoError,
  requireEnterpriseStreamerScope
} from "./_enterprise-access.js";
import { handleEnterpriseRoute, readJsonBody } from "./_enterprise.js";
import {
  mergeImportRows,
  normalizeRows,
  normalizeStreamers,
  parseRows,
  requireInsertedId,
  resolveBatchStreamerId,
  uniqueImportIds
} from "./enterprise-import-batch-helpers.js";

type ImportBody = {
  readonly sourceKind?: "csv" | "google_sheet" | "manual";
  readonly sourceLabel: string | null;
  readonly rows?: unknown;
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
      const sourceLabel = body.sourceLabel;
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

function parseImportBody(value: unknown): ImportBody {
  if (!isRecord(value)) {
    throw new EnterpriseHttpError(400, "request body must be an object");
  }
  if (!Array.isArray(value.rows)) {
    throw new EnterpriseHttpError(400, "rows must be an array");
  }
  return {
    sourceKind: parseSourceKind(value.sourceKind),
    sourceLabel: parseOptionalText(value.sourceLabel, "sourceLabel must be a string"),
    rows: value.rows
  };
}

function normalizeSourceKind(value: "csv" | "google_sheet" | "manual" | undefined): "csv" | "google_sheet" | "manual" {
  return value ?? "csv";
}

function parseSourceKind(value: unknown): "csv" | "google_sheet" | "manual" | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value === "csv" || value === "google_sheet" || value === "manual") {
    return value;
  }
  throw new EnterpriseHttpError(400, "sourceKind is invalid");
}

function parseOptionalText(value: unknown, message: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new EnterpriseHttpError(400, message);
  }
  return normalizeOptionalText(value);
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
