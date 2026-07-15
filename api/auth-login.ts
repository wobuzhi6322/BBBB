import { createClient } from "@supabase/supabase-js";
import type { IncomingMessage, ServerResponse } from "node:http";

import { isOwnerEmail } from "./_owner.js";

type AuthBody = {
  email?: unknown;
  password?: unknown;
};

type LicenseGateRow = {
  status: string;
  expires_at: string | null;
};

const licensesTable = "bbbb_account_licenses";
const noActiveLicenseMessage = "사용 가능한 요금제가 없습니다. 관리자에게 문의해 주세요.";

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
    const supabase = anonClient();
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) {
      throw new Error(result.error.message);
    }
    const userEmail = result.data.user?.email || email;
    if (!isOwnerEmail(userEmail) && !(await hasUsableLicense(result.data.user?.id))) {
      sendJson(res, 403, { ok: false, error: noActiveLicenseMessage, code: "no-active-license" });
      return;
    }
    sendJson(res, 200, {
      ok: true,
      data: {
        session: result.data.session,
        user: result.data.user
      }
    });
  } catch (error) {
    sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : "auth-login-failed" });
  }
}

// 요금제 게이트: 활성(status=active)이고 만료되지 않은 라이선스가 하나라도 있어야 로그인 허용.
// 관리자 비활성화(status 변경)·기간 만료 모두 여기서 차단된다. 오너 이메일은 예외(_owner.ts).
async function hasUsableLicense(userId: string | undefined): Promise<boolean> {
  if (!userId) {
    return false;
  }
  const supabase = serviceClient();
  const result = await supabase
    .from(licensesTable)
    .select("status,expires_at")
    .eq("user_id", userId)
    .eq("status", "active");
  if (result.error) {
    throw new Error(result.error.message);
  }
  const rows = (result.data || []) as LicenseGateRow[];
  return rows.some((license) => !license.expires_at || new Date(license.expires_at).getTime() > Date.now());
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


function anonClient() {
  const url = process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
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
