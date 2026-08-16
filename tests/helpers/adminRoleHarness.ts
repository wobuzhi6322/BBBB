import type { IncomingMessage, ServerResponse } from "node:http";

export type ManagedRole = "admin" | "user";

type ProfileRow = {
  readonly user_id: string;
  readonly email: string;
  role: ManagedRole;
  role_version: number;
};

export type RoleHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

export type SentResponse = {
  status: number;
  body: string;
  headers: Record<string, string>;
};

export const ownerEmail = "wobuzhi6322@gmail.com";
export const ownerUserId = "49ba6b61-f491-47a5-a687-97dcf4c14b61";
export const targetUserId = "11111111-1111-4111-8111-111111111111";

export const roleState = {
  actor: { id: ownerUserId, email: ownerEmail } as {
    id: string;
    email: string | null;
  } | null,
  actorError: null as Error | null,
  actorRole: "user" as ManagedRole,
  targetProfile: {
    user_id: targetUserId,
    email: "member@example.com",
    role: "user",
    role_version: 7
  } as ProfileRow | null,
  targetAuthUserId: targetUserId,
  targetAuthEmail: "member@example.com" as string | null,
  targetAuthError: null as Error | null,
  profileReadError: null as { code: string; message: string } | null,
  rpcError: null as { message: string } | null,
  forceConflict: false,
  getUserCalls: 0,
  directUpdateAttempts: 0,
  rpcCalls: 0,
  rpcName: "",
  rpcArgs: null as Record<string, unknown> | null
};

export function createAdminRoleClient() {
  return {
    auth: {
      async getUser() {
        roleState.getUserCalls += 1;
        return {
          data: { user: roleState.actor },
          error: roleState.actorError
        };
      },
      admin: {
        async getUserById(userId: string) {
          if (roleState.targetAuthError || !roleState.targetAuthEmail || userId !== roleState.targetAuthUserId) {
            return {
              data: { user: null },
              error: roleState.targetAuthError || new Error("user-not-found")
            };
          }
          return {
            data: {
              user: {
                id: roleState.targetAuthUserId,
                email: roleState.targetAuthEmail
              }
            },
            error: null
          };
        }
      }
    },
    rpc(name: string, args: Record<string, unknown>) {
      roleState.rpcCalls += 1;
      roleState.rpcName = name;
      roleState.rpcArgs = args;
      return {
        async maybeSingle() {
          if (roleState.rpcError) {
            return { data: null, error: roleState.rpcError };
          }
          const profile = roleState.targetProfile;
          if (
            !profile ||
            roleState.forceConflict ||
            args.p_target_user_id !== profile.user_id ||
            args.p_expected_role !== profile.role ||
            args.p_expected_role_version !== profile.role_version
          ) {
            return { data: null, error: null };
          }
          profile.role = args.p_new_role as ManagedRole;
          profile.role_version += 1;
          return {
            data: {
              ...profile,
              audit_event_id: "22222222-2222-4222-8222-222222222222"
            },
            error: null
          };
        }
      };
    },
    from(table: string) {
      let selected = "";
      const filters: Record<string, unknown> = {};
      const query = {
        select(columns: string) {
          selected = columns;
          return query;
        },
        update(_payload: Record<string, unknown>) {
          roleState.directUpdateAttempts += 1;
          return query;
        },
        eq(column: string, value: unknown) {
          filters[column] = value;
          return query;
        },
        async single() {
          if (table !== "bbbb_site_profiles") {
            return { data: null, error: new Error("unexpected-table") };
          }
          if (selected === "role") {
            return { data: { role: roleState.actorRole }, error: null };
          }
          if (roleState.profileReadError) {
            return { data: null, error: roleState.profileReadError };
          }
          if (!roleState.targetProfile || filters.user_id !== roleState.targetProfile.user_id) {
            return { data: null, error: { code: "PGRST116", message: "profile-not-found" } };
          }
          return { data: { ...roleState.targetProfile }, error: null };
        },
        async maybeSingle() {
          return { data: null, error: new Error("direct-update-forbidden") };
        }
      };
      return query;
    }
  };
}

export function resetRoleState(): void {
  roleState.actor = { id: ownerUserId, email: ownerEmail };
  roleState.actorError = null;
  roleState.actorRole = "user";
  roleState.targetProfile = {
    user_id: targetUserId,
    email: "member@example.com",
    role: "user",
    role_version: 7
  };
  roleState.targetAuthUserId = targetUserId;
  roleState.targetAuthEmail = "member@example.com";
  roleState.targetAuthError = null;
  roleState.profileReadError = null;
  roleState.rpcError = null;
  roleState.forceConflict = false;
  roleState.getUserCalls = 0;
  roleState.directUpdateAttempts = 0;
  roleState.rpcCalls = 0;
  roleState.rpcName = "";
  roleState.rpcArgs = null;
}

export function roleBody(
  role: ManagedRole,
  expectedRole: ManagedRole,
  expectedRoleVersion = 7
): string {
  return JSON.stringify({ userId: targetUserId, role, expectedRole, expectedRoleVersion });
}

export async function invokeRole(
  handler: RoleHandler,
  body: string,
  headers: Record<string, string> = {
    authorization: "Bearer owner-token",
    origin: "https://www.gaeideuk.com",
    "sec-fetch-site": "same-origin",
    "content-type": "application/json"
  }
): Promise<SentResponse> {
  const { response, sent } = fakeResponse();
  await handler(fakeRequest(body, headers), response);
  return sent;
}

function fakeRequest(body: string, headers: Record<string, string>): IncomingMessage {
  const bytes = Buffer.from(body, "utf8");
  return {
    method: "PATCH",
    url: "/api/admin-role",
    headers,
    socket: { remoteAddress: "127.0.0.1" },
    async *[Symbol.asyncIterator]() {
      yield bytes;
    }
  } as unknown as IncomingMessage;
}

function fakeResponse(): { readonly response: ServerResponse; readonly sent: SentResponse } {
  const sent: SentResponse = { status: 0, body: "", headers: {} };
  const response = {
    setHeader(name: string, value: number | string | readonly string[]) {
      sent.headers[name.toLowerCase()] = String(value);
      return response;
    },
    writeHead(status: number, headers?: Record<string, number | string | readonly string[]>) {
      sent.status = status;
      for (const [name, value] of Object.entries(headers || {})) {
        sent.headers[name.toLowerCase()] = String(value);
      }
      return response;
    },
    end(chunk?: unknown) {
      if (typeof chunk === "string") {
        sent.body = chunk;
      }
    }
  };
  return { response: response as unknown as ServerResponse, sent };
}
