// 엔터(소속 엔터테인먼트) 순수 로직 (api/_webShared.ts)
// - normalizeEnterpriseSlug: supabase/web-platform.sql §1.7 check 제약과 동일 규칙
// - enterpriseBadgeFromRow / enterpriseBadgeMapById: bbbb_enterprises 행 → 배지 매핑

import { describe, expect, it } from "vitest";

import {
  ENTERPRISE_NAME_MAX,
  ENTERPRISE_SLUG_PATTERN,
  enterpriseBadgeFromRow,
  enterpriseBadgeMapById,
  normalizeEnterpriseSlug
} from "../api/_webShared.js";

describe("normalizeEnterpriseSlug", () => {
  it("유효한 slug는 그대로", () => {
    expect(normalizeEnterpriseSlug("starlight")).toBe("starlight");
    expect(normalizeEnterpriseSlug("ent-01")).toBe("ent-01");
    expect(normalizeEnterpriseSlug("a")).toBe("a");
    expect(normalizeEnterpriseSlug("7up")).toBe("7up");
    expect(normalizeEnterpriseSlug("a".repeat(30))).toBe("a".repeat(30));
  });

  it("대문자·공백은 정규화(소문자화 + trim)", () => {
    expect(normalizeEnterpriseSlug("StarLight")).toBe("starlight");
    expect(normalizeEnterpriseSlug("  ent-01  ")).toBe("ent-01");
  });

  it("31자 초과·빈 값은 null", () => {
    expect(normalizeEnterpriseSlug("a".repeat(31))).toBeNull();
    expect(normalizeEnterpriseSlug("")).toBeNull();
    expect(normalizeEnterpriseSlug("   ")).toBeNull();
  });

  it("허용 외 문자·하이픈 시작은 null", () => {
    expect(normalizeEnterpriseSlug("한글엔터")).toBeNull();
    expect(normalizeEnterpriseSlug("ent 01")).toBeNull();
    expect(normalizeEnterpriseSlug("ent_01")).toBeNull();
    expect(normalizeEnterpriseSlug("-ent")).toBeNull();
  });

  it("비문자열은 null", () => {
    expect(normalizeEnterpriseSlug(null)).toBeNull();
    expect(normalizeEnterpriseSlug(undefined)).toBeNull();
    expect(normalizeEnterpriseSlug(42)).toBeNull();
  });

  it("패턴·이름 한도 상수는 DB 계약(web-platform.sql §1.7)과 동일", () => {
    expect(ENTERPRISE_SLUG_PATTERN.source).toBe("^[a-z0-9][a-z0-9-]{0,29}$");
    expect(ENTERPRISE_NAME_MAX).toBe(40);
  });
});

describe("enterpriseBadgeFromRow", () => {
  it("정상 행 → {slug, name} 배지", () => {
    expect(enterpriseBadgeFromRow({ id: "e1", slug: "starlight", name: "별빛 엔터" })).toEqual({
      slug: "starlight",
      name: "별빛 엔터"
    });
  });

  it("slug/name 누락·빈 값·비문자열·비객체는 null", () => {
    expect(enterpriseBadgeFromRow({ slug: "starlight" })).toBeNull();
    expect(enterpriseBadgeFromRow({ slug: "", name: "별빛" })).toBeNull();
    expect(enterpriseBadgeFromRow({ slug: "starlight", name: 3 })).toBeNull();
    expect(enterpriseBadgeFromRow(null)).toBeNull();
    expect(enterpriseBadgeFromRow("row")).toBeNull();
  });
});

describe("enterpriseBadgeMapById", () => {
  it("행 목록 → id→배지 맵, 오염 행은 건너뛴다", () => {
    const map = enterpriseBadgeMapById([
      { id: "e1", slug: "starlight", name: "별빛 엔터" },
      { id: "e2", slug: "moon", name: "달 엔터" },
      { id: "", slug: "ghost", name: "무시" },
      { id: "e3", slug: "", name: "무시" },
      "oops",
      null
    ]);
    expect(map.size).toBe(2);
    expect(map.get("e1")).toEqual({ slug: "starlight", name: "별빛 엔터" });
    expect(map.get("e2")).toEqual({ slug: "moon", name: "달 엔터" });
  });

  it("중복 id는 첫 행 유지", () => {
    const map = enterpriseBadgeMapById([
      { id: "e1", slug: "first", name: "첫째" },
      { id: "e1", slug: "second", name: "둘째" }
    ]);
    expect(map.get("e1")).toEqual({ slug: "first", name: "첫째" });
  });

  it("비배열은 빈 맵", () => {
    expect(enterpriseBadgeMapById(null).size).toBe(0);
    expect(enterpriseBadgeMapById({ rows: [] }).size).toBe(0);
  });
});
