// 엔터(소속 엔터테인먼트) API 통합 테스트 — 인프로세스 supabase 목
// 실 DB 없이 @supabase/supabase-js createClient를 모킹해 핸들러를 통째로 구동한다.
// 핵심 검증(계약):
//  - /api/channels?enterprise= 필터: slug 해석 실패·테이블 미생성 → 빈 목록(500 금지)
//  - 카드·페이지 뷰가 enterprise 배지를 싣는다
//  - enterprise_id 컬럼 미생성 DB → select 재시도 폴백으로 전부 무소속(null)
//  - /api/admin-enterprises: 목록+pageCount, slug 중복 409, 형식 400, 미등록 404
//  - /api/admin-web-page: enterprise_slug 지정·해제·미등록 404

import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";

type MockQuery = {
  table: string;
  select: string;
  calls: { method: string; args: unknown[] }[];
  payload: unknown;
};

type MockResult = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
};

const h = vi.hoisted(() => ({
  queries: [] as MockQuery[],
  respond: ((_state: MockQuery) => ({})) as (state: MockQuery) => MockResult
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from(table: string) {
      const state: MockQuery = { table, select: "", calls: [], payload: undefined };
      h.queries.push(state);
      const builder: Record<string, unknown> = {};
      const methods = [
        "select", "eq", "in", "or", "order", "limit", "ilike", "not",
        "maybeSingle", "single", "insert", "update", "upsert", "delete"
      ];
      for (const method of methods) {
        builder[method] = (...args: unknown[]) => {
          if (method === "select" && typeof args[0] === "string") state.select = args[0];
          if (method === "insert" || method === "update" || method === "upsert") state.payload = args[0];
          state.calls.push({ method, args });
          return builder;
        };
      }
      builder.then = (onFulfilled?: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
        const result = h.respond(state) ?? {};
        return Promise.resolve({
          data: result.data ?? null,
          error: result.error ?? null,
          count: result.count ?? null
        }).then(onFulfilled, onRejected);
      };
      return builder;
    },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }) }) },
    auth: { getUser: async () => ({ data: { user: null }, error: null }) }
  })
}));

import adminEnterprisesHandler from "../api/admin-enterprises.js";
import adminWebPageHandler from "../api/admin-web-page.js";
import channelsHandler from "../api/channels.js";
import pageHandler from "../api/page/[handle].js";

// ---------------------------------------------------------------------------
// 요청·응답 페이크
// ---------------------------------------------------------------------------

function fakeReq(
  method: string,
  url: string,
  options: { headers?: Record<string, string>; body?: unknown } = {}
): IncomingMessage {
  return {
    method,
    url,
    headers: options.headers ?? {},
    body: options.body,
    socket: { remoteAddress: "127.0.0.1" }
  } as unknown as IncomingMessage;
}

type SentCapture = { status: number; body: string };

function fakeRes(): { res: ServerResponse; sent: SentCapture } {
  const sent: SentCapture = { status: 0, body: "" };
  const res = {
    setHeader() {
      /* noop */
    },
    writeHead(status: number) {
      sent.status = status;
      return res;
    },
    end(chunk?: unknown) {
      if (typeof chunk === "string") sent.body = chunk;
    }
  };
  return { res: res as unknown as ServerResponse, sent };
}

function parseBody(sent: SentCapture): Record<string, any> {
  return JSON.parse(sent.body) as Record<string, any>;
}

function has(state: MockQuery, method: string, ...args: unknown[]): boolean {
  return state.calls.some(
    (call) => call.method === method && args.every((arg, index) => call.args[index] === arg)
  );
}

// ---------------------------------------------------------------------------
// 픽스처
// ---------------------------------------------------------------------------

const ADMIN_TOKEN = "test-admin-token";
const adminHeaders = { "x-bbbb-admin-token": ADMIN_TOKEN };

const directoryPage = {
  id: "p1",
  owner_user_id: "u1",
  handle: "star-a",
  banner_url: null,
  avatar_url: null,
  bio: null,
  created_at: "2026-07-01T00:00:00.000Z",
  team_code: null,
  enterprise_id: "e1"
};

const publicPage = {
  id: "p1",
  owner_user_id: "u1",
  handle: "star-a",
  banner_url: null,
  avatar_url: null,
  bio: null,
  broadcast_links: [],
  preset_amounts: [1000, 5000],
  min_amount: 1000,
  ticker_public: false,
  account_display: "link_only",
  account_info: null,
  transfer_links: [],
  status: "active",
  team_code: null,
  enterprise_id: "e1"
};

const adminPageRow = {
  id: "p1",
  owner_user_id: "u1",
  handle: "star-a",
  directory_optin: true,
  status: "active",
  team_code: null,
  enterprise_id: null
};

/** 디렉토리 집계 테이블(시그니처·닉네임·온라인) 기본 응답 */
function directoryAggregates(state: MockQuery): MockResult | null {
  if (state.table === "bbbb_page_signatures") return { data: [{ page_id: "p1" }] };
  if (state.table === "bbbb_web_profiles") return { data: [{ user_id: "u1", nickname: "별빛" }] };
  if (state.table === "bbbb_relay_devices") return { data: [] };
  return null;
}

beforeEach(() => {
  process.env.SUPABASE_URL = "https://mock.supabase.local";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-key";
  process.env.BBBB_SHARED_ADMIN_TOKEN = ADMIN_TOKEN;
  h.queries.length = 0;
  h.respond = () => ({});
});

// ---------------------------------------------------------------------------
// GET /api/channels — 엔터 필터·배지
// ---------------------------------------------------------------------------

describe("GET /api/channels — 엔터", () => {
  it("enterprise=<slug> 필터: 소문자 해석 + enterprise_id eq + 카드에 배지", async () => {
    h.respond = (state) => {
      const aggregate = directoryAggregates(state);
      if (aggregate) return aggregate;
      if (state.table === "bbbb_enterprises" && state.calls.some((call) => call.method === "ilike")) {
        return { data: [{ id: "e1" }] };
      }
      if (state.table === "bbbb_enterprises") {
        return { data: [{ id: "e1", slug: "starlight", name: "별빛 엔터" }] };
      }
      if (state.table === "bbbb_streamer_pages") return { data: [directoryPage] };
      return {};
    };

    const { res, sent } = fakeRes();
    await channelsHandler(fakeReq("GET", "/api/channels?enterprise=StarLight"), res);

    expect(sent.status).toBe(200);
    const body = parseBody(sent);
    expect(body.ok).toBe(true);
    expect(body.data.channels).toHaveLength(1);
    expect(body.data.channels[0].handle).toBe("star-a");
    expect(body.data.channels[0].enterprise).toEqual({ slug: "starlight", name: "별빛 엔터" });

    // 대소문자 무시 해석(소문자 정규화 후 ilike) + 페이지 쿼리에 id 필터 적용
    const resolveQuery = h.queries.find((q) => q.table === "bbbb_enterprises" && has(q, "ilike", "slug", "starlight"));
    expect(resolveQuery).toBeDefined();
    const pagesQuery = h.queries.find((q) => q.table === "bbbb_streamer_pages");
    expect(pagesQuery && has(pagesQuery, "eq", "enterprise_id", "e1")).toBe(true);
  });

  it("미등록 slug → 빈 목록(200), 페이지 쿼리 미실행", async () => {
    h.respond = (state) => {
      if (state.table === "bbbb_enterprises") return { data: [] };
      return {};
    };

    const { res, sent } = fakeRes();
    await channelsHandler(fakeReq("GET", "/api/channels?enterprise=nobody"), res);

    expect(sent.status).toBe(200);
    expect(parseBody(sent).data).toEqual({ channels: [], nextCursor: null });
    expect(h.queries.some((q) => q.table === "bbbb_streamer_pages")).toBe(false);
  });

  it("bbbb_enterprises 미생성(조회 오류) → 빈 목록(200), 500 금지", async () => {
    h.respond = (state) => {
      if (state.table === "bbbb_enterprises") {
        return { error: { message: 'relation "public.bbbb_enterprises" does not exist', code: "42P01" } };
      }
      return {};
    };

    const { res, sent } = fakeRes();
    await channelsHandler(fakeReq("GET", "/api/channels?enterprise=starlight"), res);

    expect(sent.status).toBe(200);
    expect(parseBody(sent).data).toEqual({ channels: [], nextCursor: null });
  });

  it("enterprise_id 컬럼 미생성 → 컬럼 없이 재시도, 전 카드 무소속(null)", async () => {
    h.respond = (state) => {
      const aggregate = directoryAggregates(state);
      if (aggregate) return aggregate;
      if (state.table === "bbbb_streamer_pages") {
        if (state.select.includes("enterprise_id")) {
          return { error: { message: "column bbbb_streamer_pages.enterprise_id does not exist", code: "42703" } };
        }
        const { enterprise_id: _omit, ...row } = directoryPage;
        return { data: [row] };
      }
      return {};
    };

    const { res, sent } = fakeRes();
    await channelsHandler(fakeReq("GET", "/api/channels"), res);

    expect(sent.status).toBe(200);
    const body = parseBody(sent);
    expect(body.data.channels).toHaveLength(1);
    expect(body.data.channels[0].enterprise).toBeNull();
    expect(body.data.channels[0].displayName).toBe("별빛");
    // 배지 조회 자체가 없어야 한다(전부 무소속)
    expect(h.queries.some((q) => q.table === "bbbb_enterprises")).toBe(false);
  });

  it("배지 배치 조회 실패는 카드 유지 + 배지만 null", async () => {
    h.respond = (state) => {
      const aggregate = directoryAggregates(state);
      if (aggregate) return aggregate;
      if (state.table === "bbbb_streamer_pages") return { data: [directoryPage] };
      if (state.table === "bbbb_enterprises") {
        return { error: { message: 'relation "public.bbbb_enterprises" does not exist', code: "42P01" } };
      }
      return {};
    };

    const { res, sent } = fakeRes();
    await channelsHandler(fakeReq("GET", "/api/channels"), res);

    expect(sent.status).toBe(200);
    const body = parseBody(sent);
    expect(body.data.channels).toHaveLength(1);
    expect(body.data.channels[0].enterprise).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/page/:handle — 엔터 배지
// ---------------------------------------------------------------------------

describe("GET /api/page/:handle — 엔터", () => {
  it("소속 페이지 응답에 enterprise 배지를 싣는다", async () => {
    h.respond = (state) => {
      if (state.table === "bbbb_streamer_pages") return { data: publicPage };
      if (state.table === "bbbb_web_profiles") return { data: { nickname: "별빛" } };
      if (state.table === "bbbb_page_signatures") return { data: [] };
      if (state.table === "bbbb_relay_devices") return { data: [] };
      if (state.table === "bbbb_enterprises") {
        return { data: [{ id: "e1", slug: "starlight", name: "별빛 엔터" }] };
      }
      return {};
    };

    const { res, sent } = fakeRes();
    await pageHandler(fakeReq("GET", "/api/page/star-a?handle=star-a"), res);

    expect(sent.status).toBe(200);
    const body = parseBody(sent);
    expect(body.data.handle).toBe("star-a");
    expect(body.data.enterprise).toEqual({ slug: "starlight", name: "별빛 엔터" });
  });

  it("enterprise_id 컬럼 미생성 → 폴백 select, enterprise null(200)", async () => {
    h.respond = (state) => {
      if (state.table === "bbbb_streamer_pages") {
        if (state.select.includes("enterprise_id")) {
          return { error: { message: "column bbbb_streamer_pages.enterprise_id does not exist", code: "42703" } };
        }
        const { enterprise_id: _omit, ...row } = publicPage;
        return { data: row };
      }
      if (state.table === "bbbb_web_profiles") return { data: { nickname: "별빛" } };
      if (state.table === "bbbb_page_signatures") return { data: [] };
      if (state.table === "bbbb_relay_devices") return { data: [] };
      return {};
    };

    const { res, sent } = fakeRes();
    await pageHandler(fakeReq("GET", "/api/page/star-a?handle=star-a"), res);

    expect(sent.status).toBe(200);
    const body = parseBody(sent);
    expect(body.data.handle).toBe("star-a");
    expect(body.data.enterprise).toBeNull();
    expect(h.queries.some((q) => q.table === "bbbb_enterprises")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// /api/admin-enterprises
// ---------------------------------------------------------------------------

describe("/api/admin-enterprises", () => {
  it("GET: 목록 + 소속 페이지 수", async () => {
    h.respond = (state) => {
      if (state.table === "bbbb_enterprises") {
        return {
          data: [
            { id: "e1", slug: "starlight", name: "별빛 엔터", created_at: "2026-07-01T00:00:00.000Z" },
            { id: "e2", slug: "moon", name: "달 엔터", created_at: "2026-07-02T00:00:00.000Z" }
          ]
        };
      }
      if (state.table === "bbbb_streamer_pages") {
        return { data: [{ enterprise_id: "e1" }, { enterprise_id: "e1" }] };
      }
      return {};
    };

    const { res, sent } = fakeRes();
    await adminEnterprisesHandler(fakeReq("GET", "/api/admin-enterprises", { headers: adminHeaders }), res);

    expect(sent.status).toBe(200);
    expect(parseBody(sent).data.enterprises).toEqual([
      { id: "e1", slug: "starlight", name: "별빛 엔터", pageCount: 2 },
      { id: "e2", slug: "moon", name: "달 엔터", pageCount: 0 }
    ]);
  });

  it("POST: slug 소문자 정규화 + 생성", async () => {
    h.respond = (state) => {
      if (state.table === "bbbb_enterprises" && state.calls.some((call) => call.method === "insert")) {
        return { data: { id: "e9", slug: "starlight", name: "별빛 엔터" } };
      }
      return {};
    };

    const { res, sent } = fakeRes();
    await adminEnterprisesHandler(
      fakeReq("POST", "/api/admin-enterprises", {
        headers: adminHeaders,
        body: { name: " 별빛 엔터 ", slug: " StarLight " }
      }),
      res
    );

    expect(sent.status).toBe(200);
    expect(parseBody(sent).data.enterprise).toEqual({ id: "e9", slug: "starlight", name: "별빛 엔터", pageCount: 0 });
    const insertQuery = h.queries.find((q) => q.calls.some((call) => call.method === "insert"));
    expect(insertQuery?.payload).toEqual({ slug: "starlight", name: "별빛 엔터" });
  });

  it("POST: slug 중복(23505) → 409 한국어 안내", async () => {
    h.respond = (state) => {
      if (state.table === "bbbb_enterprises" && state.calls.some((call) => call.method === "insert")) {
        return { error: { message: "duplicate key value violates unique constraint", code: "23505" } };
      }
      return {};
    };

    const { res, sent } = fakeRes();
    await adminEnterprisesHandler(
      fakeReq("POST", "/api/admin-enterprises", { headers: adminHeaders, body: { name: "별빛 엔터", slug: "starlight" } }),
      res
    );

    expect(sent.status).toBe(409);
    expect(parseBody(sent).error).toBe("이미 등록된 엔터 슬러그입니다.");
  });

  it("POST: slug 형식 위반 → 400, DB 미접촉", async () => {
    const { res, sent } = fakeRes();
    await adminEnterprisesHandler(
      fakeReq("POST", "/api/admin-enterprises", { headers: adminHeaders, body: { name: "별빛", slug: "한글슬러그" } }),
      res
    );

    expect(sent.status).toBe(400);
    expect(parseBody(sent).error).toContain("슬러그");
    expect(h.queries).toHaveLength(0);
  });

  it("PATCH: 미등록 slug → 404 '등록되지 않은 엔터입니다.'", async () => {
    h.respond = (state) => {
      if (state.table === "bbbb_enterprises") return { data: [] };
      return {};
    };

    const { res, sent } = fakeRes();
    await adminEnterprisesHandler(
      fakeReq("PATCH", "/api/admin-enterprises", { headers: adminHeaders, body: { slug: "nobody", name: "새 이름" } }),
      res
    );

    expect(sent.status).toBe(404);
    expect(parseBody(sent).error).toBe("등록되지 않은 엔터입니다.");
  });

  it("인증 없음 → 401, 허용 외 메서드 → 405", async () => {
    const unauth = fakeRes();
    await adminEnterprisesHandler(fakeReq("GET", "/api/admin-enterprises"), unauth.res);
    expect(unauth.sent.status).toBe(401);

    const wrongMethod = fakeRes();
    await adminEnterprisesHandler(fakeReq("PUT", "/api/admin-enterprises", { headers: adminHeaders }), wrongMethod.res);
    expect(wrongMethod.sent.status).toBe(405);
  });
});

// ---------------------------------------------------------------------------
// /api/admin-web-page — enterprise_slug 확장
// ---------------------------------------------------------------------------

describe("/api/admin-web-page — enterprise_slug", () => {
  it("PATCH: 미등록 slug → 404 '등록되지 않은 엔터입니다.'", async () => {
    h.respond = (state) => {
      if (state.table === "bbbb_streamer_pages") return { data: adminPageRow };
      if (state.table === "bbbb_enterprises") return { data: [] };
      return {};
    };

    const { res, sent } = fakeRes();
    await adminWebPageHandler(
      fakeReq("PATCH", "/api/admin-web-page", { headers: adminHeaders, body: { handle: "star-a", enterprise_slug: "nobody" } }),
      res
    );

    expect(sent.status).toBe(404);
    expect(parseBody(sent).error).toBe("등록되지 않은 엔터입니다.");
  });

  it("PATCH: 빈 문자열 → 소속 해제(enterprise_id null)", async () => {
    h.respond = (state) => {
      if (state.table === "bbbb_streamer_pages" && state.calls.some((call) => call.method === "update")) {
        return { data: { ...adminPageRow, enterprise_id: null } };
      }
      if (state.table === "bbbb_streamer_pages") return { data: adminPageRow };
      return {};
    };

    const { res, sent } = fakeRes();
    await adminWebPageHandler(
      fakeReq("PATCH", "/api/admin-web-page", { headers: adminHeaders, body: { handle: "star-a", enterprise_slug: "" } }),
      res
    );

    expect(sent.status).toBe(200);
    expect(parseBody(sent).data.page.enterprise_slug).toBeNull();
    const updateQuery = h.queries.find(
      (q) => q.table === "bbbb_streamer_pages" && q.calls.some((call) => call.method === "update")
    );
    expect((updateQuery?.payload as Record<string, unknown>).enterprise_id).toBeNull();
  });

  it("PATCH: 등록 slug → enterprise_id 배정 + 요약에 enterprise_slug", async () => {
    h.respond = (state) => {
      if (state.table === "bbbb_enterprises" && state.calls.some((call) => call.method === "ilike")) {
        return { data: [{ id: "e1" }] };
      }
      if (state.table === "bbbb_enterprises") return { data: [{ slug: "starlight" }] };
      if (state.table === "bbbb_streamer_pages" && state.calls.some((call) => call.method === "update")) {
        return { data: { ...adminPageRow, enterprise_id: "e1" } };
      }
      if (state.table === "bbbb_streamer_pages") return { data: adminPageRow };
      return {};
    };

    const { res, sent } = fakeRes();
    await adminWebPageHandler(
      fakeReq("PATCH", "/api/admin-web-page", { headers: adminHeaders, body: { handle: "star-a", enterprise_slug: "StarLight" } }),
      res
    );

    expect(sent.status).toBe(200);
    expect(parseBody(sent).data.page.enterprise_slug).toBe("starlight");
    const updateQuery = h.queries.find(
      (q) => q.table === "bbbb_streamer_pages" && q.calls.some((call) => call.method === "update")
    );
    expect((updateQuery?.payload as Record<string, unknown>).enterprise_id).toBe("e1");
  });
});
