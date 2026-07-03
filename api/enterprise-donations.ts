import type { IncomingMessage, ServerResponse } from "node:http";

import { requireEnterpriseStreamerScope } from "./_enterprise-access.js";
import { handleEnterpriseRoute } from "./_enterprise.js";

const donationsTable = "bbbb_enterprise_donations";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleEnterpriseRoute(req, res, {
    methods: ["GET"],
    capability: "donationRecords",
    run: async ({ url, supabase, access }) => {
      const requestedStreamerId = normalizeOptionalText(url.searchParams.get("streamerId"));
      const scopedStreamerId = requireEnterpriseStreamerScope(access, requestedStreamerId);
      const query = supabase
        .from(donationsTable)
        .select("id,enterprise_id,streamer_id,import_id,donor_name,donor_key,amount_krw,donated_on")
        .eq("enterprise_id", access.enterpriseId)
        .order("donated_on", { ascending: false });
      if (scopedStreamerId !== null) {
        query.eq("streamer_id", scopedStreamerId);
      }
      const donationsResult = await query;
      return { donations: donationsResult.data ?? [] };
    }
  });
}

function normalizeOptionalText(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized ? normalized : null;
}
