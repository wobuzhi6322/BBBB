// =============================================================================
// 웹 후원 플랫폼 공유 계약 모듈 (WS0)
// 계약 문서: donation-system/docs/WEB_TECH_SPEC.md
// 이 파일의 타입·상수·규칙이 트랙 간 계약이다. 변경은 통합자 승인 필요.
// Vercel 라우팅 규칙: '_' 접두 파일은 엔드포인트로 노출되지 않는다.
// =============================================================================

// ---------------------------------------------------------------------------
// 응답 봉투 (저장소 기존 관례: { ok, data } / { ok:false, error })
// ---------------------------------------------------------------------------

export type ApiOk<T> = { ok: true; data: T };
export type ApiErr = { ok: false; error: string; code?: WebErrorCode };
export type ApiResult<T> = ApiOk<T> | ApiErr;

export type WebErrorCode =
  | "method-not-allowed"
  | "auth-required"
  | "forbidden"
  | "not-found"
  | "handle-taken"
  | "handle-invalid"
  | "handle-reserved"
  | "amount-too-small"
  | "amount-invalid"
  | "message-too-long"
  | "nickname-invalid"
  | "blocked-word"
  | "blocked-donor"
  | "rate-limited"
  | "message-expired"
  | "code-exhausted"
  | "device-key-invalid"
  | "connect-code-invalid"
  | "page-suspended"
  | "validation-failed";

// ---------------------------------------------------------------------------
// 한도·상수 (WEB_TECH_SPEC·WEB_PAGE_SPECS 준거)
// ---------------------------------------------------------------------------

export const LIMITS = {
  nicknameMax: 20,
  messageMax: 200,
  bioMax: 500,
  webTitleMax: 60,
  minAmountFloor: 100,
  minAmountDefault: 1000,
  presetsDefault: [1000, 5000, 10000, 50000] as readonly number[],
  messageTtlMinutes: 30,
  graceMinutes: 60,
  heartbeatOnlineSeconds: 180,
  relayPollSeconds: 30,
  heartbeatIntervalSeconds: 60,
  thumbMaxKb: 200,
  donationMsgPerMinPerIp: 5,
  pinnedMax: 3,
  handleChangeCooldownDays: 30
} as const;

// ---------------------------------------------------------------------------
// 핸들 규칙
// ---------------------------------------------------------------------------

export const RESERVED_HANDLES: readonly string[] = [
  "admin", "api", "app", "assets", "auth", "about", "account", "ads",
  "bbbb", "blog", "channel", "channels", "dev", "docs", "download",
  "downloads", "gaeideuk", "gyeideuk", "help", "home", "login", "logout",
  "m", "me", "news", "ops", "overlay", "privacy", "relay", "releases",
  "root", "settings", "signup", "site", "static", "studio", "support",
  "terms", "test", "wallet", "ws", "www"
];

const HANDLE_PATTERN = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;

export function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle) && !RESERVED_HANDLES.includes(handle);
}

export function handleRejectCode(handle: string): WebErrorCode | null {
  if (!HANDLE_PATTERN.test(handle)) return "handle-invalid";
  if (RESERVED_HANDLES.includes(handle)) return "handle-reserved";
  return null;
}

// ---------------------------------------------------------------------------
// 입금코드 (WEB_TECH_SPEC §4)
// 형식: 닉네임 앞 4자(한글 유지) + 대문자 영숫자 2자(부족 시 3자).
// 은행 입금자명 제약(한글·영숫자, 특수문자 불가, 통상 ≤10자) 안에서 동작한다.
// ---------------------------------------------------------------------------

/** 혼동 문자(I, L, O, 0, 1) 제외 알파벳 */
export const DEPOSIT_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** 매칭 비교용 정규화: NFC → 공백 전부 제거 → 대문자화 */
export function normalizeDepositTag(value: string): string {
  return value.normalize("NFC").replace(/\s+/g, "").toUpperCase();
}

/** 닉네임에서 코드 베이스 추출: 한글·영숫자만 남기고 앞 4자, 비면 '후원' */
export function nicknameCodeBase(nickname: string): string {
  const cleaned = nickname.normalize("NFC").replace(/[^0-9A-Za-z가-힣]/g, "");
  return cleaned.slice(0, 4) || "후원";
}

export type DepositCode = { code: string; codeNorm: string };

/**
 * 활성 pending 코드 집합(takenNorms, code_norm 기준)과 충돌하지 않는 코드를 발급한다.
 * 접미 2자로 40회 시도 → 실패 시 3자로 확장. rand 주입은 테스트용.
 */
export function generateDepositCode(
  nickname: string,
  takenNorms: ReadonlySet<string>,
  rand: () => number = Math.random
): DepositCode {
  const base = nicknameCodeBase(nickname);
  for (let suffixLen = 2; suffixLen <= 3; suffixLen += 1) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      let suffix = "";
      for (let i = 0; i < suffixLen; i += 1) {
        const idx = Math.floor(rand() * DEPOSIT_CODE_ALPHABET.length) % DEPOSIT_CODE_ALPHABET.length;
        suffix += DEPOSIT_CODE_ALPHABET[idx];
      }
      const code = `${base}${suffix}`;
      const codeNorm = normalizeDepositTag(code);
      if (!takenNorms.has(codeNorm)) {
        return { code, codeNorm };
      }
    }
  }
  throw new Error("code-exhausted");
}

/** 리스너가 파싱한 입금자명(raw)이 코드에 매칭되는가 (①항: 포함 판정) */
export function senderMatchesCode(senderRaw: string, codeNorm: string): boolean {
  if (!senderRaw || !codeNorm) return false;
  return normalizeDepositTag(senderRaw).includes(codeNorm);
}

/** 매칭 시간창 판정 (③항): 메시지 생성 ≤ 입금시각 ≤ grace_until */
export function isWithinMatchWindow(createdAtIso: string, graceUntilIso: string, depositAtMs: number): boolean {
  const created = Date.parse(createdAtIso);
  const grace = Date.parse(graceUntilIso);
  if (Number.isNaN(created) || Number.isNaN(grace)) return false;
  return depositAtMs >= created && depositAtMs <= grace;
}

// ---------------------------------------------------------------------------
// 입력 검증 (공용)
// ---------------------------------------------------------------------------

export function validateDonationInput(input: {
  nickname: string;
  message: string;
  amount: number;
  minAmount: number;
}): WebErrorCode | null {
  const nickname = input.nickname.trim();
  if (!nickname || nickname.length > LIMITS.nicknameMax) return "nickname-invalid";
  if (input.message.length > LIMITS.messageMax) return "message-too-long";
  if (!Number.isInteger(input.amount) || input.amount <= 0) return "amount-invalid";
  if (input.amount < input.minAmount) return "amount-too-small";
  return null;
}

// ---------------------------------------------------------------------------
// 도메인 타입 — 공개 API (WEB_TECH_SPEC §2.1)
// ---------------------------------------------------------------------------

export type BroadcastLink = { platform: "chzzk" | "soop" | "youtube" | "other"; url: string };
export type TransferLink = { type: "toss" | "kakao"; url: string };

export type PublicSignatureCard = {
  id: string;
  title: string;
  amount: number;
  mediaType: "image" | "gif" | "video" | "audio";
  thumbUrl: string | null;
  pinned: boolean;
};

export type PublicPageView = {
  handle: string;
  displayName: string;
  bannerUrl: string | null;
  avatarUrl: string | null;
  bio: string | null;
  broadcastLinks: BroadcastLink[];
  presetAmounts: number[];
  minAmount: number;
  tickerPublic: boolean;
  online: boolean;
  signatures: PublicSignatureCard[];
  transferLinks: TransferLink[];
  /** account_display='full'일 때만 채워짐 */
  accountInfo: { bank: string; number: string; holder: string } | null;
};

// ---------------------------------------------------------------------------
// 팀코드 (프로그램 공유 코드 → 시그니처 메뉴 소스)
// 형식은 api/shared-profile.ts normalizeCode와 동일해야 한다: trim → 대문자
// 정규화 → ^[A-Z0-9][A-Z0-9-]{2,63}$. 위반 시 throw 대신 null을 반환하고
// 호출자가 WebErrorCode 봉투(validation-failed 등)로 매핑한다.
// ---------------------------------------------------------------------------

export const TEAM_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,63}$/;

export function normalizeTeamCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase();
  if (!TEAM_CODE_PATTERN.test(code)) return null;
  return code;
}

/** bbbb_shared_profile_versions.bundle.rules 항목(프로그램 DonationRule) 중 웹이 쓰는 필드 */
export type SharedBundleRule = {
  key?: unknown;
  title?: unknown;
  minAmount?: unknown;
  enabled?: unknown;
  image?: unknown;
  video?: unknown;
  sound?: unknown;
};

/** bbbb_shared_profile_versions.media_files 항목 중 웹이 쓰는 필드 */
export type SharedMediaFile = {
  kind?: unknown;
  filename?: unknown;
  storagePath?: unknown;
};

type EligibleBundleRule = {
  key: string;
  title: string;
  amount: number;
  image: string | null;
  video: string | null;
  sound: string | null;
};

function bundleString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/** bundle.rules에서 웹 노출 대상(enabled && minAmount>0 && key 有)만 추출 */
function eligibleBundleRules(bundle: unknown): EligibleBundleRule[] {
  if (!bundle || typeof bundle !== "object" || Array.isArray(bundle)) return [];
  const rules = (bundle as Record<string, unknown>).rules;
  if (!Array.isArray(rules)) return [];
  const eligible: EligibleBundleRule[] = [];
  for (const raw of rules as SharedBundleRule[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.enabled !== true) continue;
    const amount = typeof raw.minAmount === "number" && Number.isFinite(raw.minAmount) ? raw.minAmount : 0;
    if (amount <= 0) continue;
    const key = bundleString(raw.key);
    if (!key) continue;
    const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : key;
    eligible.push({
      key,
      title,
      amount,
      image: bundleString(raw.image),
      video: bundleString(raw.video),
      sound: bundleString(raw.sound)
    });
  }
  return eligible;
}

/** 경로/파일명 혼재 대응 — 마지막 세그먼트만 비교 (rule.image는 '/assets/user/images/x.png' 형태 실측) */
function mediaBasename(value: string): string {
  const norm = value.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx === -1 ? norm : norm.slice(idx + 1);
}

/** rule.image(경로 또는 파일명) → media_files의 storagePath (kind='images' 우선, 베이스네임 매칭) */
function imageStoragePath(image: string, mediaFiles: unknown): string | null {
  if (!Array.isArray(mediaFiles)) return null;
  const target = mediaBasename(image);
  if (!target) return null;
  let fallback: string | null = null;
  for (const raw of mediaFiles as SharedMediaFile[]) {
    if (!raw || typeof raw !== "object") continue;
    const filename = typeof raw.filename === "string" ? raw.filename : "";
    if (!filename || mediaBasename(filename) !== target) continue;
    const storagePath = bundleString(raw.storagePath);
    if (!storagePath) continue;
    if (raw.kind === "images") return storagePath;
    if (!fallback) fallback = storagePath;
  }
  return fallback;
}

/** 썸네일 서명 URL 일괄 발급에 필요한 storagePath 목록(중복 제거, 순수 함수) */
export function teamCodeThumbPaths(bundle: unknown, mediaFiles: unknown): string[] {
  const paths = new Set<string>();
  for (const rule of eligibleBundleRules(bundle)) {
    if (!rule.image) continue;
    const path = imageStoragePath(rule.image, mediaFiles);
    if (path) paths.add(path);
  }
  return [...paths];
}

/**
 * 공유 번들(rules) → 공개 시그니처 카드 목록(순수 함수 — Supabase 미접촉).
 * enabled && minAmount>0 규칙만, minAmount 오름차순.
 * mediaType: video 우선 → image(.gif=gif) → sound=audio → 기본 image.
 * thumbUrl은 이미지 규칙만: media_files에서 filename 일치 항목의 storagePath로
 * signedUrlByPath를 조회(없으면 null). 서명 URL 발급(비공개 버킷)은 호출자 책임.
 * 카드 형태는 PublicSignatureCard 그대로 — bbbb_page_signatures 경로와 동일 계약.
 */
export function sharedBundleToSignatureCards(
  bundle: unknown,
  mediaFiles: unknown,
  signedUrlByPath: Readonly<Record<string, string>>
): PublicSignatureCard[] {
  const cards: PublicSignatureCard[] = eligibleBundleRules(bundle).map((rule) => {
    const mediaType: PublicSignatureCard["mediaType"] = rule.video
      ? "video"
      : rule.image
        ? /\.gif$/i.test(rule.image)
          ? "gif"
          : "image"
        : rule.sound
          ? "audio"
          : "image";
    const storagePath = rule.image ? imageStoragePath(rule.image, mediaFiles) : null;
    return {
      id: `tc-${rule.key}`,
      title: rule.title,
      amount: rule.amount,
      mediaType,
      thumbUrl: storagePath ? (signedUrlByPath[storagePath] ?? null) : null,
      pinned: false
    };
  });
  cards.sort((a, b) => a.amount - b.amount);
  return cards;
}

export type ChannelCard = {
  handle: string;
  displayName: string;
  bannerUrl: string | null;
  avatarUrl: string | null;
  bio: string | null;
  signatureCount: number;
  online: boolean;
};

export type CreateDonationMessageBody = {
  nickname: string;
  message: string;
  amount: number;
};

export type DonationMessageCreated = {
  messageId: string;
  depositCode: string;
  amount: number;
  expiresAt: string;
  transferLinks: TransferLink[];
  accountInfo: PublicPageView["accountInfo"];
};

export type DonationMessageStatus = {
  status: "pending" | "matched" | "expired" | "blocked";
  matchedAt: string | null;
};

export type ReportBody = {
  targetType: "page" | "signature" | "message";
  targetId: string;
  reason: string;
};

// ---------------------------------------------------------------------------
// 도메인 타입 — 시청자 (§2.2)
// ---------------------------------------------------------------------------

export type WebProfile = {
  nickname: string;
  avatarUrl: string | null;
  roles: ("viewer" | "streamer")[];
  defaultMessage: string | null;
  notifyEmail: boolean;
};

export type MyDonationItem = {
  messageId: string;
  handle: string;
  displayName: string;
  amount: number;
  message: string;
  status: DonationMessageStatus["status"];
  createdAt: string;
};

// ---------------------------------------------------------------------------
// 도메인 타입 — 스튜디오 (§2.3)
// ---------------------------------------------------------------------------

export type StudioPageSettings = {
  handle: string;
  /** 핸들 마지막 변경 시각(30일 쿨다운 UI용) — 서버가 additive로 내려줌 */
  handleChangedAt?: string | null;
  /** 팀코드(프로그램 공유 코드) — 설정 시 공개 시그니처 메뉴 소스. null=미사용 */
  teamCode?: string | null;
  bannerUrl: string | null;
  avatarUrl: string | null;
  bio: string | null;
  broadcastLinks: BroadcastLink[];
  presetAmounts: number[];
  minAmount: number;
  tickerPublic: boolean;
  directoryOptin: boolean;
  accountDisplay: "link_only" | "full";
  accountInfo: PublicPageView["accountInfo"];
  transferLinks: TransferLink[];
};

export type StudioSignatureRow = PublicSignatureCard & {
  localSignatureId: string;
  webTitle: string | null;
  published: boolean;
  sort: number;
  syncedAt: string;
};

export type StudioDonationRow = {
  matchId: string;
  messageId: string | null;
  matchedBy: "auto" | "manual" | null;
  senderRaw: string | null;
  amount: number | null;
  nickname: string | null;
  message: string | null;
  reportedAt: string;
};

// ---------------------------------------------------------------------------
// 도메인 타입 — 릴레이 (§2.4, 인증: X-Device-Key)
// ---------------------------------------------------------------------------

export const RELAY_DEVICE_KEY_HEADER = "x-device-key";

export type RelayPendingItem = {
  messageId: string;
  codeNorm: string;
  amount: number;
  nickname: string;
  message: string;
  createdAt: string;
  expiresAt: string;
  graceUntil: string;
};

export type RelayMatchReportBody = {
  /** 멱등 키: 로컬 후원 이벤트 식별자 */
  localDonationId: string;
  senderRaw: string;
  amount: number;
  /** null = 미매칭 입금 보고(수동 매칭 후보) */
  messageId: string | null;
};

export type RelaySignatureSyncItem = {
  localSignatureId: string;
  title: string;
  amount: number;
  mediaType: PublicSignatureCard["mediaType"];
  /** base64 (≤ LIMITS.thumbMaxKb KB), null이면 썸네일 유지 */
  thumbBase64: string | null;
};

export type RelaySignaturesSyncBody = { signatures: RelaySignatureSyncItem[] };

export type RelayHeartbeatResponse = {
  /** 서버가 시그니처 재동기화를 요구할 때 true */
  requestSignatureSync: boolean;
};
