// 팀코드 → 시그니처 메뉴 순수 로직 (api/_webShared.ts)
// - normalizeTeamCode: api/shared-profile.ts normalizeCode와 동일 형식(대문자 정규화)
// - sharedBundleToSignatureCards: 공유 번들 rules → PublicSignatureCard[] (계약 형태 불변)
// - teamCodeThumbPaths: 서명 URL 일괄 발급용 storagePath 수집

import { describe, expect, it } from "vitest";

import {
  TEAM_CODE_PATTERN,
  normalizeTeamCode,
  sharedBundleToSignatureCards,
  teamCodeThumbPaths
} from "../api/_webShared.js";

describe("normalizeTeamCode", () => {
  it("유효한 코드는 그대로", () => {
    expect(normalizeTeamCode("TEAM-01")).toBe("TEAM-01");
    expect(normalizeTeamCode("ABC")).toBe("ABC");
    expect(normalizeTeamCode("A".repeat(64))).toBe("A".repeat(64));
  });

  it("소문자·공백은 정규화(대문자화 + trim)", () => {
    expect(normalizeTeamCode("team-01")).toBe("TEAM-01");
    expect(normalizeTeamCode("  gaeideuk  ")).toBe("GAEIDEUK");
  });

  it("3자 미만·64자 초과는 null", () => {
    expect(normalizeTeamCode("AB")).toBeNull();
    expect(normalizeTeamCode("A".repeat(65))).toBeNull();
  });

  it("허용 외 문자·하이픈 시작은 null", () => {
    expect(normalizeTeamCode("팀코드")).toBeNull();
    expect(normalizeTeamCode("TEAM 01")).toBeNull();
    expect(normalizeTeamCode("TEAM_01")).toBeNull();
    expect(normalizeTeamCode("-TEAM")).toBeNull();
  });

  it("빈 값·비문자열은 null", () => {
    expect(normalizeTeamCode("")).toBeNull();
    expect(normalizeTeamCode("   ")).toBeNull();
    expect(normalizeTeamCode(null)).toBeNull();
    expect(normalizeTeamCode(undefined)).toBeNull();
    expect(normalizeTeamCode(123)).toBeNull();
  });

  it("패턴 상수는 shared-profile normalizeCode와 동일", () => {
    expect(TEAM_CODE_PATTERN.source).toBe("^[A-Z0-9][A-Z0-9-]{2,63}$");
  });
});

describe("sharedBundleToSignatureCards", () => {
  const mediaFiles = [
    { kind: "images", filename: "balloon.png", size: 10, updatedAt: "t", storagePath: "T/v1/images/balloon.png" },
    { kind: "images", filename: "party.gif", size: 10, updatedAt: "t", storagePath: "T/v1/images/party.gif" },
    { kind: "sounds", filename: "horn.mp3", size: 10, updatedAt: "t", storagePath: "T/v1/sounds/horn.mp3" }
  ];
  const signedUrls = {
    "T/v1/images/balloon.png": "https://signed/balloon",
    "T/v1/images/party.gif": "https://signed/party"
  };

  it("enabled=true && minAmount>0 만 남기고 minAmount 오름차순 정렬", () => {
    const bundle = {
      rules: [
        { key: "big", title: "큰거", minAmount: 50000, enabled: true },
        { key: "off", title: "꺼짐", minAmount: 1000, enabled: false },
        { key: "zero", title: "0원", minAmount: 0, enabled: true },
        { key: "small", title: "작은거", minAmount: 1000, enabled: true }
      ]
    };
    const cards = sharedBundleToSignatureCards(bundle, [], {});
    expect(cards.map((card) => card.id)).toEqual(["tc-small", "tc-big"]);
    expect(cards.map((card) => card.amount)).toEqual([1000, 50000]);
  });

  it("mediaType 매핑: video 우선 → gif → image → audio → 기본 image", () => {
    const bundle = {
      rules: [
        { key: "v", title: "v", minAmount: 100, enabled: true, video: "clip.mp4", image: "balloon.png" },
        { key: "g", title: "g", minAmount: 200, enabled: true, image: "party.gif" },
        { key: "i", title: "i", minAmount: 300, enabled: true, image: "balloon.png" },
        { key: "a", title: "a", minAmount: 400, enabled: true, sound: "horn.mp3" },
        { key: "n", title: "n", minAmount: 500, enabled: true }
      ]
    };
    const cards = sharedBundleToSignatureCards(bundle, mediaFiles, signedUrls);
    // 정렬은 minAmount 오름차순: v(100)→g(200)→i(300)→a(400)→n(500)
    expect(cards.map((card) => card.mediaType)).toEqual(["video", "gif", "image", "audio", "image"]);
  });

  it("썸네일: 이미지 규칙만 media_files→signedUrlByPath로 조회, 히트/미스", () => {
    const bundle = {
      rules: [
        { key: "hit", title: "히트", minAmount: 100, enabled: true, image: "balloon.png" },
        { key: "nofile", title: "파일없음", minAmount: 200, enabled: true, image: "ghost.png" },
        { key: "nourl", title: "URL없음", minAmount: 300, enabled: true, image: "party.gif" },
        { key: "audio", title: "소리", minAmount: 400, enabled: true, sound: "horn.mp3" }
      ]
    };
    const cards = sharedBundleToSignatureCards(bundle, mediaFiles, {
      "T/v1/images/balloon.png": "https://signed/balloon"
    });
    expect(cards.find((card) => card.id === "tc-hit")?.thumbUrl).toBe("https://signed/balloon");
    expect(cards.find((card) => card.id === "tc-nofile")?.thumbUrl).toBeNull();
    expect(cards.find((card) => card.id === "tc-nourl")?.thumbUrl).toBeNull();
    expect(cards.find((card) => card.id === "tc-audio")?.thumbUrl).toBeNull();
  });

  it("rule.image가 경로형이어도 베이스네임으로 media_files와 매칭한다 (프로그램 번들 실측 형태)", () => {
    // 실번들: rule.image='/assets/user/images/x.png', media_files.filename='x.png'
    const bundle = {
      rules: [
        { key: "path", title: "경로형", minAmount: 500, enabled: true, image: "/assets/user/images/balloon.png" },
        { key: "winpath", title: "역슬래시", minAmount: 600, enabled: true, image: "assets\\user\\images\\party.gif" }
      ]
    };
    const mediaFiles = [
      { kind: "images", filename: "balloon.png", size: 10, updatedAt: "t", storagePath: "T/v1/images/balloon.png" },
      { kind: "images", filename: "party.gif", size: 10, updatedAt: "t", storagePath: "T/v1/images/party.gif" }
    ];
    const cards = sharedBundleToSignatureCards(bundle, mediaFiles, {
      "T/v1/images/balloon.png": "https://signed/balloon",
      "T/v1/images/party.gif": "https://signed/party"
    });
    expect(cards.find((card) => card.id === "tc-path")?.thumbUrl).toBe("https://signed/balloon");
    expect(cards.find((card) => card.id === "tc-winpath")?.thumbUrl).toBe("https://signed/party");
    expect(cards.find((card) => card.id === "tc-winpath")?.mediaType).toBe("gif");
  });

  it("퍼센트 인코딩된 rule 참조를 디코딩해 매칭하고, 영상은 mediaUrl로 서명 URL을 싣는다 (BBBB-003 실측)", () => {
    // 실번들: rule.video='/assets/user/videos/%EC%86%8C%EC%A4%91...mp4'(인코딩),
    //         media_files.filename='소중한후원-obs.mp4'(디코딩 한글)
    const bundle = {
      rules: [
        {
          key: "kr",
          title: "소중한 후원",
          minAmount: 1000,
          enabled: true,
          video: "/assets/user/videos/" + encodeURIComponent("소중한후원-obs.mp4")
        }
      ]
    };
    const mediaFiles = [
      {
        kind: "videos",
        filename: "소중한후원-obs.mp4",
        size: 10,
        updatedAt: "t",
        storagePath: "BBBB-003/v44/videos/sanitized-abc.mp4"
      }
    ];
    expect(teamCodeThumbPaths(bundle, mediaFiles)).toContain("BBBB-003/v44/videos/sanitized-abc.mp4");
    const cards = sharedBundleToSignatureCards(bundle, mediaFiles, {
      "BBBB-003/v44/videos/sanitized-abc.mp4": "https://signed/kr-video"
    });
    expect(cards[0]?.mediaType).toBe("video");
    expect(cards[0]?.mediaUrl).toBe("https://signed/kr-video");
    expect(cards[0]?.thumbUrl).toBeNull();
  });

  it("카드 계약 형태 유지: id는 tc- 접두, pinned는 항상 false, 제목 폴백=key", () => {
    const bundle = { rules: [{ key: "sig1", title: "  ", minAmount: 1000, enabled: true }] };
    const [card] = sharedBundleToSignatureCards(bundle, [], {});
    expect(card).toEqual({
      id: "tc-sig1",
      title: "sig1",
      amount: 1000,
      mediaType: "image",
      thumbUrl: null,
      mediaUrl: null,
      pinned: false
    });
  });

  it("rules 배열 없음·번들 비객체·key 없는 규칙은 안전하게 []/스킵", () => {
    expect(sharedBundleToSignatureCards({}, [], {})).toEqual([]);
    expect(sharedBundleToSignatureCards(null, [], {})).toEqual([]);
    expect(sharedBundleToSignatureCards("bundle", [], {})).toEqual([]);
    expect(sharedBundleToSignatureCards({ rules: "x" }, [], {})).toEqual([]);
    expect(sharedBundleToSignatureCards({ rules: [{ title: "키없음", minAmount: 100, enabled: true }] }, [], {})).toEqual([]);
  });
});

describe("teamCodeThumbPaths", () => {
  const mediaFiles = [
    { kind: "sounds", filename: "balloon.png", size: 1, updatedAt: "t", storagePath: "T/v1/sounds/balloon.png" },
    { kind: "images", filename: "balloon.png", size: 1, updatedAt: "t", storagePath: "T/v1/images/balloon.png" },
    { kind: "images", filename: "party.gif", size: 1, updatedAt: "t", storagePath: "T/v1/images/party.gif" }
  ];

  it("노출 대상 이미지 규칙의 storagePath만, 중복 제거·images kind 우선", () => {
    const bundle = {
      rules: [
        { key: "a", minAmount: 100, enabled: true, image: "balloon.png" },
        { key: "b", minAmount: 200, enabled: true, image: "balloon.png" },
        { key: "c", minAmount: 300, enabled: true, image: "party.gif" },
        { key: "d", minAmount: 400, enabled: false, image: "party.gif" },
        { key: "e", minAmount: 500, enabled: true, sound: "horn.mp3" }
      ]
    };
    expect(teamCodeThumbPaths(bundle, mediaFiles)).toEqual(["T/v1/images/balloon.png", "T/v1/images/party.gif"]);
  });

  it("media_files가 배열이 아니거나 매칭 없음 → []", () => {
    const bundle = { rules: [{ key: "a", minAmount: 100, enabled: true, image: "ghost.png" }] };
    expect(teamCodeThumbPaths(bundle, mediaFiles)).toEqual([]);
    expect(teamCodeThumbPaths(bundle, null)).toEqual([]);
  });
});
