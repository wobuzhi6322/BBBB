import type { IncomingMessage, ServerResponse } from "node:http";

import { requireEnterpriseStreamerScope } from "./_enterprise-access.js";
import { handleEnterpriseRoute } from "./_enterprise.js";

type EnterpriseRow = {
  readonly id: string;
  readonly name?: string | null;
};

type StreamerRow = {
  readonly id: string;
  readonly display_name?: string | null;
};

type DonationRow = {
  readonly streamer_id: string;
  readonly donor_key?: string | null;
  readonly donor_name?: string | null;
  readonly amount_krw: number;
  readonly donated_on: string;
  readonly import_id?: string | null;
};

type ImportRow = {
  readonly id: string;
  readonly created_at?: string | null;
};

const enterprisesTable = "bbbb_enterprises";
const streamersTable = "bbbb_enterprise_streamers";
const importsTable = "bbbb_enterprise_donation_imports";
const donationsTable = "bbbb_enterprise_donations";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  await handleEnterpriseRoute(req, res, {
    methods: ["GET"],
    capability: "summary",
    run: async ({ supabase, access }) => {
      const scopedStreamerId = requireEnterpriseStreamerScope(access, null);
      const enterpriseResult = await supabase
        .from(enterprisesTable)
        .select("id,name")
        .eq("id", access.enterpriseId)
        .maybeSingle();
      const streamersResult = await supabase
        .from(streamersTable)
        .select("id,display_name")
        .eq("enterprise_id", access.enterpriseId);
      const importsResult = await supabase
        .from(importsTable)
        .select("id,created_at")
        .eq("enterprise_id", access.enterpriseId)
        .order("created_at", { ascending: false });
      const donationsQuery = supabase
        .from(donationsTable)
        .select("streamer_id,donor_key,donor_name,amount_krw,donated_on,import_id")
        .eq("enterprise_id", access.enterpriseId)
        .order("donated_on", { ascending: true });
      if (scopedStreamerId !== null) {
        donationsQuery.eq("streamer_id", scopedStreamerId);
      }
      const donationsResult = await donationsQuery;

      const enterprise = (enterpriseResult.data ?? null) as EnterpriseRow | null;
      const allStreamers = ((streamersResult.data ?? []) as StreamerRow[]).filter((streamer) =>
        scopedStreamerId === null ? true : streamer.id === scopedStreamerId
      );
      const donations = (donationsResult.data ?? []) as DonationRow[];
      const imports = (importsResult.data ?? []) as ImportRow[];
      const topStreamers = summarizeTopStreamers(donations, allStreamers);

      return {
        enterprise,
        teamName: enterprise?.name ?? "Enterprise",
        totals: {
          totalAmountKrw: sumAmounts(donations),
          totalAmount: sumAmounts(donations),
          donorCount: uniqueDonorCount(donations),
          streamerCount: uniqueStreamerCount(donations, allStreamers),
          donationCount: donations.length,
          importBatchCount: visibleImportCount(access.role, donations, imports)
        },
        streamers: access.role === "viewer" ? [] : allStreamers,
        recentImports: access.role === "viewer" ? [] : imports.slice(0, 5),
        topStreamers,
        dailyTotals: summarizeDailyTotals(donations)
      };
    }
  });
}

function sumAmounts(donations: readonly DonationRow[]): number {
  return donations.reduce((sum, donation) => sum + Number(donation.amount_krw || 0), 0);
}

function uniqueDonorCount(donations: readonly DonationRow[]): number {
  return new Set(donations.map((donation) => donation.donor_key ?? donation.donor_name ?? "")).size;
}

function uniqueStreamerCount(donations: readonly DonationRow[], streamers: readonly StreamerRow[]): number {
  if (donations.length === 0) {
    return streamers.length;
  }
  return new Set(donations.map((donation) => donation.streamer_id)).size;
}

function visibleImportCount(role: string, donations: readonly DonationRow[], imports: readonly ImportRow[]): number {
  if (role === "viewer") {
    return 0;
  }
  const importedIds = new Set(donations.map((donation) => donation.import_id).filter((value): value is string => Boolean(value)));
  return importedIds.size || imports.length;
}

function summarizeDailyTotals(donations: readonly DonationRow[]) {
  const totals = new Map<string, { totalAmountKrw: number; donationCount: number }>();
  for (const donation of donations) {
    const current = totals.get(donation.donated_on) ?? { totalAmountKrw: 0, donationCount: 0 };
    current.totalAmountKrw += Number(donation.amount_krw || 0);
    current.donationCount += 1;
    totals.set(donation.donated_on, current);
  }
  return [...totals.entries()].map(([date, value]) => ({ date, ...value }));
}

function summarizeTopStreamers(donations: readonly DonationRow[], streamers: readonly StreamerRow[]) {
  const names = new Map(streamers.map((streamer) => [streamer.id, streamer.display_name ?? streamer.id]));
  const totals = new Map<string, { totalAmountKrw: number; donationCount: number }>();
  for (const donation of donations) {
    const current = totals.get(donation.streamer_id) ?? { totalAmountKrw: 0, donationCount: 0 };
    current.totalAmountKrw += Number(donation.amount_krw || 0);
    current.donationCount += 1;
    totals.set(donation.streamer_id, current);
  }
  return [...totals.entries()]
    .map(([streamerId, value]) => ({ streamerId, streamerName: names.get(streamerId) ?? streamerId, ...value }))
    .sort((left, right) => right.totalAmountKrw - left.totalAmountKrw);
}
