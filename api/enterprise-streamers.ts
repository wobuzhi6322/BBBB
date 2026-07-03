import type { IncomingMessage, ServerResponse } from "node:http";

import { EnterpriseHttpError, requireEnterpriseStreamerScope } from "./_enterprise-access.js";
import { handleEnterpriseRoute, readJsonBody } from "./_enterprise.js";

type StreamerBody = {
  readonly displayName?: unknown;
};

const streamersTable = "bbbb_enterprise_streamers";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleEnterpriseRoute(req, res, {
    methods: ["GET", "POST"],
    capability: req.method === "POST" ? "manageStreamers" : "streamers",
    run: async ({ method, req: request, supabase, access }) => {
      if (method === "POST") {
        const body = (await readJsonBody(request)) as StreamerBody;
        const displayName = normalizeText(body.displayName, "displayName is required");
        const insertResult = await supabase
          .from(streamersTable)
          .insert({
            enterprise_id: access.enterpriseId,
            display_name: displayName,
            is_active: true
          })
          .select("id,enterprise_id,display_name,is_active")
          .single();
        return { streamer: insertResult.data };
      }

      const scopedStreamerId = requireEnterpriseStreamerScope(access, null);
      const query = supabase
        .from(streamersTable)
        .select("id,enterprise_id,display_name,is_active")
        .eq("enterprise_id", access.enterpriseId)
        .order("display_name", { ascending: true });
      if (scopedStreamerId !== null) {
        query.eq("id", scopedStreamerId);
      }
      const streamersResult = await query;
      return { streamers: streamersResult.data ?? [] };
    }
  });
}

function normalizeText(value: unknown, message: string): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new EnterpriseHttpError(400, message);
  }
  return normalized;
}
