import type { IncomingMessage, ServerResponse } from "node:http";

import { sendJson } from "./_admin-session.js";

const allowedCommandKeys = new Set(["expectedRole", "expectedRoleVersion", "role", "userId"]);
const userIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const roleCommandMaxBytes = 2 * 1024;

export type ManagedRole = "admin" | "user";

export type RoleChangeCommand = {
  readonly userId: string;
  readonly role: ManagedRole;
  readonly expectedRole: ManagedRole;
  readonly expectedRoleVersion: number;
};

export type TargetProfile = {
  readonly userId: string;
  readonly email: string | null;
  readonly role: ManagedRole;
  readonly roleVersion: number;
};

type RoleChangeFailure = {
  readonly status: 400 | 404 | 409 | 415;
  readonly code:
    | "profile-not-found"
    | "role-conflict"
    | "role-validation-failed"
    | "owner-role-immutable"
    | "unsupported-media-type";
  readonly message: string;
};

export class RoleChangeError extends Error {
  readonly status: RoleChangeFailure["status"];
  readonly code: RoleChangeFailure["code"];

  constructor(failure: RoleChangeFailure) {
    super(failure.message);
    this.name = "RoleChangeError";
    this.status = failure.status;
    this.code = failure.code;
  }
}

export function parseRoleChangeCommand(body: Record<string, unknown>): RoleChangeCommand {
  const keys = Object.keys(body);
  const userId = body.userId;
  const role = parseManagedRole(body.role);
  const expectedRole = parseManagedRole(body.expectedRole);
  const expectedRoleVersion = body.expectedRoleVersion;
  if (
    keys.length !== allowedCommandKeys.size ||
    keys.some((key) => !allowedCommandKeys.has(key)) ||
    typeof userId !== "string" ||
    !userIdPattern.test(userId) ||
    !role ||
    !expectedRole ||
    typeof expectedRoleVersion !== "number" ||
    !Number.isSafeInteger(expectedRoleVersion) ||
    expectedRoleVersion < 0
  ) {
    throw roleError(400, "role-validation-failed", "관리자 권한 변경 요청이 올바르지 않습니다.");
  }
  return { userId, role, expectedRole, expectedRoleVersion };
}

export function parseTargetProfile(value: unknown): TargetProfile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const userId: unknown = Reflect.get(value, "user_id");
  const email: unknown = Reflect.get(value, "email");
  const role = parseManagedRole(Reflect.get(value, "role"));
  const roleVersion: unknown = Reflect.get(value, "role_version");
  if (
    typeof userId !== "string" ||
    (email !== null && typeof email !== "string") ||
    !role ||
    typeof roleVersion !== "number" ||
    !Number.isSafeInteger(roleVersion) ||
    roleVersion < 0
  ) {
    return null;
  }
  return { userId, email, role, roleVersion };
}

export function parseRoleChangeResult(
  value: unknown
): (TargetProfile & { readonly auditEventId: string }) | null {
  const profile = parseTargetProfile(value);
  const auditEventId: unknown =
    value && typeof value === "object" && !Array.isArray(value)
      ? Reflect.get(value, "audit_event_id")
      : null;
  if (!profile || typeof auditEventId !== "string") {
    return null;
  }
  return { ...profile, auditEventId };
}

export function sendRoleResponse(
  res: ServerResponse,
  profile: TargetProfile,
  isOwner: boolean,
  auditEventId: string | null
): void {
  sendJson(res, 200, {
    ok: true,
    data: {
      profile: {
        userId: profile.userId,
        role: profile.role,
        roleVersion: profile.roleVersion,
        isOwner
      },
      auditEventId
    }
  });
}

export function roleError(
  status: RoleChangeFailure["status"],
  code: RoleChangeFailure["code"],
  message: string
): RoleChangeError {
  return new RoleChangeError({ status, code, message });
}

export function assertJsonContentType(req: IncomingMessage): void {
  const contentType = headerValue(req.headers["content-type"]);
  if (!contentType || contentType.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
    throw roleError(415, "unsupported-media-type", "JSON 요청만 허용됩니다.");
  }
}

export function safeRequestId(value: string | string[] | undefined): string | null {
  const requestId = headerValue(value)?.trim();
  return requestId ? requestId.slice(0, 200) : null;
}

function parseManagedRole(value: unknown): ManagedRole | null {
  return value === "admin" || value === "user" ? value : null;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
