import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage } from "node:http";

type EnterpriseRole = "owner" | "admin" | "streamer" | "viewer";

type EnterpriseCapability =
  | "summary"
  | "streamers"
  | "importBatches"
  | "donationRecords"
  | "writeImports"
  | "manageStreamers";

type EnterpriseRoleCapabilities = Record<EnterpriseRole, Record<EnterpriseCapability, boolean>>;

type EnterpriseMemberRow = {
  readonly role: EnterpriseRole;
  readonly streamer_id: string | null;
};

export type EnterpriseAccess = {
  readonly enterpriseId: string;
  readonly userId: string;
  readonly email: string | null;
  readonly role: EnterpriseRole;
  readonly streamerId: string | null;
  readonly ownerAccount: boolean;
};

export class EnterpriseHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "EnterpriseHttpError";
    this.status = status;
  }
}

export const enterpriseRoleCapabilities: EnterpriseRoleCapabilities = {
  owner: {
    summary: true,
    streamers: true,
    importBatches: true,
    donationRecords: true,
    writeImports: true,
    manageStreamers: true
  },
  admin: {
    summary: true,
    streamers: true,
    importBatches: true,
    donationRecords: true,
    writeImports: true,
    manageStreamers: true
  },
  streamer: {
    summary: true,
    streamers: true,
    importBatches: true,
    donationRecords: true,
    writeImports: false,
    manageStreamers: false
  },
  viewer: {
    summary: true,
    streamers: false,
    importBatches: false,
    donationRecords: false,
    writeImports: false,
    manageStreamers: false
  }
};

export const mutationRoles = ["owner", "admin"] as const;

const membersTable = "bbbb_enterprise_members";
const profilesTable = "bbbb_site_profiles";
const defaultOwnerEmails = ["wobuzhi6322@gmail.com"] as const;

export function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new EnterpriseHttpError(500, "supabase-config-missing");
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}

export function assertNoError(error: { readonly message: string } | null | undefined): void {
  if (error) {
    throw new EnterpriseHttpError(500, error.message);
  }
}

export async function requireEnterpriseUser(req: IncomingMessage, supabase = serviceClient()) {
  const token = bearerToken(req);
  if (!token) {
    throw new EnterpriseHttpError(401, "login-required");
  }
  const result = await supabase.auth.getUser(token);
  const user = result.data.user;
  if (result.error || !user) {
    throw new EnterpriseHttpError(401, "invalid-session");
  }
  return user;
}

export async function ensureEnterpriseProfile(input: {
  readonly userId: string;
  readonly email: string | null;
  readonly supabase?: ReturnType<typeof serviceClient>;
}): Promise<void> {
  const supabase = input.supabase ?? serviceClient();
  const result = await supabase.from(profilesTable).upsert(
    {
      user_id: input.userId,
      email: input.email,
      updated_at: new Date().toISOString()
    },
    { onConflict: "user_id" }
  );
  assertNoError(result.error);
}

export async function createEnterpriseAccess(input: {
  readonly req?: IncomingMessage;
  readonly supabase?: ReturnType<typeof serviceClient>;
  readonly enterpriseId: string;
  readonly capability?: EnterpriseCapability;
  readonly method?: string;
}): Promise<EnterpriseAccess> {
  const supabase = input.supabase ?? serviceClient();
  const user = input.req ? await requireEnterpriseUser(input.req, supabase) : await requireEnterpriseUserFromClient(supabase);
  const userId = user.id;
  const email = typeof user.email === "string" ? user.email : null;
  const enterpriseId = input.enterpriseId;
  await ensureEnterpriseProfile({ userId, email, supabase });

  const membership = await supabase
    .from(membersTable)
    .select("role,streamer_id")
    .eq("enterprise_id", enterpriseId)
    .eq("user_id", userId)
    .maybeSingle();
  assertNoError(membership.error);

  const ownerAccount = isOwnerEmail(email);
  const member = membership.data as EnterpriseMemberRow | null;
  if (!member) {
    throw new EnterpriseHttpError(403, "non-member");
  }

  const access: EnterpriseAccess = {
    enterpriseId,
    userId,
    email,
    role: member.role,
    streamerId: member.streamer_id,
    ownerAccount
  };

  if (input.capability && !enterpriseRoleCapabilities[access.role][input.capability]) {
    throw new EnterpriseHttpError(403, "mutation-forbidden");
  }
  if (input.method === "POST" && !mutationRoles.includes(access.role as (typeof mutationRoles)[number])) {
    throw new EnterpriseHttpError(403, "mutation-forbidden");
  }

  return access;
}

export function requireEnterpriseStreamerScope(access: EnterpriseAccess, requestedStreamerId: string | null): string | null {
  if (access.role !== "streamer") {
    return requestedStreamerId;
  }
  if (!access.streamerId) {
    throw new EnterpriseHttpError(403, "streamer-scope-required");
  }
  if (requestedStreamerId !== null && requestedStreamerId !== access.streamerId) {
    throw new EnterpriseHttpError(403, "streamer-forbidden");
  }
  return access.streamerId;
}

function bearerToken(req: IncomingMessage): string | undefined {
  const value = headerValue(req.headers.authorization);
  const match = value?.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function isOwnerEmail(value: string | null): boolean {
  const ownerEmails = new Set(
    (process.env.BBBB_OWNER_EMAILS || defaultOwnerEmails.join(","))
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean)
  );
  return Boolean(value && ownerEmails.has(value.trim().toLowerCase()));
}

async function requireEnterpriseUserFromClient(supabase: ReturnType<typeof serviceClient>) {
  const result = await supabase.auth.getUser();
  const user = result.data.user;
  if (result.error || !user) {
    throw new EnterpriseHttpError(401, "invalid-session");
  }
  return user;
}
