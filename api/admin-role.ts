import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { AdminRequestError, assertAdminOrigin, requireOwnerUser } from "./_admin-auth.js";
import {
  assertJsonContentType,
  parseRoleChangeCommand,
  parseRoleChangeResult,
  parseTargetProfile,
  roleCommandMaxBytes,
  RoleChangeError,
  roleError,
  safeRequestId,
  sendRoleResponse,
  type TargetProfile
} from "./_admin-role.js";
import { sendJson } from "./_admin-session.js";
import { isOwnerUserId } from "./_owner.js";
import { readJsonObject, RequestBodyError } from "./_request-body.js";

const profilesTable = "bbbb_site_profiles";
const profileSelect = "user_id,email,role,role_version";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    if (req.method === "OPTIONS") {
      assertAdminOrigin(req);
      sendJson(res, 204, {});
      return;
    }

    if (req.method !== "PATCH") {
      sendJson(res, 405, { ok: false, error: "method-not-allowed" });
      return;
    }

    const supabase = serviceClient();
    const principal = await requireOwnerUser(req, supabase);
    assertJsonContentType(req);
    const command = parseRoleChangeCommand(await readJsonObject(req, roleCommandMaxBytes));
    const currentProfile = await findTargetProfile(command.userId, supabase);
    const targetAuth = await supabase.auth.admin.getUserById(command.userId);
    const targetUser = targetAuth.data.user;
    if (targetAuth.error) {
      if (targetAuth.error.status === 404) {
        throw roleError(404, "profile-not-found", "대상 회원을 찾을 수 없습니다.");
      }
      throw new Error("admin-role-auth-read-failed", { cause: targetAuth.error });
    }
    if (!targetUser) {
      throw roleError(404, "profile-not-found", "대상 회원을 찾을 수 없습니다.");
    }

    const targetIsOwner = isOwnerUserId(targetUser.id);
    if (targetIsOwner) {
      throw roleError(409, "owner-role-immutable", "소유자 계정의 관리자 권한은 변경할 수 없습니다.");
    }
    if (
      currentProfile.role !== command.expectedRole ||
      currentProfile.roleVersion !== command.expectedRoleVersion
    ) {
      throw roleError(409, "role-conflict", "회원 권한이 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }

    if (currentProfile.role === command.role) {
      sendRoleResponse(res, currentProfile, false, null);
      return;
    }

    const requestId = safeRequestId(req.headers["x-vercel-id"]);
    const changeResult = await supabase
      .rpc("bbbb_owner_change_admin_role", {
        p_actor_user_id: principal.userId,
        p_target_user_id: command.userId,
        p_expected_role: command.expectedRole,
        p_expected_role_version: command.expectedRoleVersion,
        p_new_role: command.role,
        p_reason: null,
        p_request_id: requestId
      })
      .maybeSingle();
    if (changeResult.error) {
      throw new Error("admin-role-rpc-failed", { cause: changeResult.error });
    }

    const updatedProfile = parseRoleChangeResult(changeResult.data);
    if (!updatedProfile) {
      throw roleError(409, "role-conflict", "회원 권한이 이미 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    }

    console.info(
      JSON.stringify({
        event: "admin.role-change",
        outcome: "changed",
        actorUserId: principal.userId,
        targetUserId: updatedProfile.userId,
        previousRole: currentProfile.role,
        role: updatedProfile.role,
        roleVersion: updatedProfile.roleVersion,
        auditEventId: updatedProfile.auditEventId,
        requestId
      })
    );
    sendRoleResponse(res, updatedProfile, false, updatedProfile.auditEventId);
  } catch (error) {
    if (error instanceof AdminRequestError || error instanceof RequestBodyError || error instanceof RoleChangeError) {
      sendJson(res, error.status, { ok: false, error: error.message, code: error.code });
      return;
    }

    console.error(
      JSON.stringify({
        event: "admin.role-change",
        outcome: "failed",
        status: 500,
        requestId: safeRequestId(req.headers["x-vercel-id"])
      })
    );
    sendJson(res, 500, { ok: false, error: "관리자 권한을 변경하지 못했습니다.", code: "role-change-failed" });
  }
}

async function findTargetProfile(
  userId: string,
  supabase: ReturnType<typeof serviceClient>
): Promise<TargetProfile> {
  const result = await supabase
    .from(profilesTable)
    .select(profileSelect)
    .eq("user_id", userId)
    .single();
  const profile = parseTargetProfile(result.data);
  if (result.error) {
    if (result.error.code === "PGRST116") {
      throw roleError(404, "profile-not-found", "대상 회원을 찾을 수 없습니다.");
    }
    throw new Error("admin-role-profile-read-failed", { cause: result.error });
  }
  if (!profile) {
    throw roleError(404, "profile-not-found", "대상 회원을 찾을 수 없습니다.");
  }
  return profile;
}

function serviceClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
}
