import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { profilePatchFromBody, type ProfilePatchBody } from "./_profile.js";

type AuthBody = {
  email?: unknown;
  password?: unknown;
} & ProfilePatchBody;

const profilesTable = "bbbb_site_profiles";

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    sendJson(res, 405, { ok: false, error: "method-not-allowed" });
    return;
  }

  try {
    const body = await readJson(req);
    const email = requiredString(body.email, "이메일을 입력해 주세요.");
    const password = requiredString(body.password, "비밀번호를 입력해 주세요.");
    const channel = profilePatchFromBody(body);
    const supabase = serviceClient();
    const result = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        channel_platform: channel.channel_platform,
        channel_name: channel.channel_name,
        channel_url: channel.channel_url
      }
    });
    if (result.error) {
      throw new Error(result.error.message);
    }
    const user = result.data.user;
    if (!user?.id) {
      throw new Error("회원가입 사용자를 생성할 수 없습니다.");
    }
    await ensureProfile(user.id, email, channel, supabase);
    sendJson(res, 200, {
      ok: true,
      data: {
        user: {
          id: user.id,
          email: user.email
        }
      }
    });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "auth-signup-failed" });
  }
}

async function ensureProfile(
  userId: string,
  email: string,
  channel: ReturnType<typeof profilePatchFromBody>,
  supabase: ReturnType<typeof serviceClient>
): Promise<void> {
  const result = await supabase.from(profilesTable).upsert(
    {
      user_id: userId,
      email,
      ...channel
    },
    { onConflict: "user_id" }
  );
  if (result.error) {
    throw new Error(result.error.message);
  }
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

async function readJson(req: IncomingMessage): Promise<AuthBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as AuthBody;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }
  return value.trim();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST,OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

function setCors(res: ServerResponse): void {
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
}
