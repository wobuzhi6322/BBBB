const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const files = [
  "admin-private/index.html",
  "admin-private/admin.js",
  "admin-private/admin.css",
  "api/auth-signup.ts",
  "public/index.html",
  "public/login.html",
  "public/assets/site.js",
  "public/assets/site.css",
  "vercel.json"
];

const requiredAdminIds = [
  "admin-splash",
  "admin-login-wrapper",
  "admin-login-form",
  "login-email",
  "login-password",
  "login-error-msg",
  "admin-dashboard-wrapper",
  "admin-user-email",
  "admin-logout-btn",
  "license-search-form",
  "search-query",
  "search-feedback",
  "user-details-container",
  "detail-profile-role",
  "detail-profile-name",
  "detail-profile-email",
  "detail-profile-channel",
  "detail-profile-channel-url",
  "detail-profile-id",
  "detail-profile-category",
  "detail-profile-notes",
  "active-license-details",
  "no-active-license-msg",
  "detail-license-status",
  "detail-license-id",
  "detail-license-code",
  "detail-license-plan",
  "detail-license-sigs",
  "detail-license-media",
  "detail-license-devices",
  "detail-license-expires",
  "detail-license-notes",
  "manage-license-form",
  "form-user-id",
  "form-license-id",
  "form-license-plan",
  "form-license-status",
  "form-license-sigs",
  "form-license-media",
  "form-license-expires",
  "flag-shared-sync",
  "form-license-notes",
  "form-submit-btn",
  "license-form-title",
  "license-action-feedback",
  "license-history-table",
  "form-profile-name",
  "form-profile-category",
  "form-profile-notes",
  "folders-loading-msg",
  "folder-bulk-toolbar",
  "folder-selected-count",
  "folder-select-all-visible",
  "folder-selection-clear",
  "folder-move-target",
  "folder-move-btn",
  "folder-category-options",
  "folder-bulk-license-form",
  "folder-bulk-license-btn",
  "folder-bulk-plan",
  "folder-bulk-status",
  "folder-bulk-sigs",
  "folder-bulk-media",
  "folder-bulk-expires",
  "folder-bulk-shared-sync",
  "folder-bulk-message",
  "folders-container",
  "btn-refresh-folders",
  "form-channel-platform",
  "form-channel-name",
  "form-channel-url",
  "admin-device-lookup",
  "admin-device-clear-all",
  "admin-device-message",
  "admin-device-result",
  "create-code-form",
  "code-plan",
  "code-mode",
  "code-duration-unit",
  "code-duration-value",
  "code-duration-value-group",
  "code-max-redemptions",
  "code-valid-until",
  "code-flag-shared-sync",
  "code-notes",
  "code-action-feedback",
  "code-result-panel",
  "result-code-display",
  "btn-copy-code",
  "result-code-badge",
  "result-code-duration",
  "result-code-redemptions",
  "recent-codes-table",
  "recent-redemptions-table"
];

const requiredAdminCssClasses = [
  "admin-content",
  "admin-card",
  "admin-form-grid",
  "admin-search-form",
  "search-row",
  "feature-checks",
  "admin-details-grid",
  "info-grid",
  "folders-container",
  "folder-bulk-toolbar",
  "folder-bulk-actions",
  "folder-bulk-license-form",
  "folder-user-checkbox",
  "folder-category-checkbox",
  "admin-device-card",
  "admin-device-actions",
  "admin-device-list",
  "admin-device-row",
  "code-result-row",
  "table-wrap",
  "full-span"
];

const forbiddenPatterns = [
  { pattern: /\uFFFD/, reason: "replacement character" },
  { pattern: /怨|愿|諛|濡|蹂|理|遺/, reason: "mojibake Korean text" },
  { pattern: /\?™|\?댁|\?쇱|\?뚯|媛\?/, reason: "mojibake fragments" },
  { pattern: /[^\s<](?:\/code>|\/strong>|\/span>)/, reason: "escaped broken closing tag visible in UI" },
  { pattern: /<title>[^<]*\/title>/, reason: "broken title closing tag" }
];

const failures = [];

for (const file of files) {
  const absolute = path.join(root, file);
  if (!fs.existsSync(absolute)) {
    failures.push(`${file}: missing`);
    continue;
  }
  const text = fs.readFileSync(absolute, "utf8");
  for (const { pattern, reason } of forbiddenPatterns) {
    if (pattern.test(text)) {
      failures.push(`${file}: ${reason}`);
    }
  }
}

const adminHtml = fs.readFileSync(path.join(root, "admin-private/index.html"), "utf8");
const adminCss = fs.readFileSync(path.join(root, "admin-private/admin.css"), "utf8");
const adminJs = fs.readFileSync(path.join(root, "admin-private/admin.js"), "utf8");
const signupApi = fs.readFileSync(path.join(root, "api/auth-signup.ts"), "utf8");
// 투네이션 재구성(2026-07-11): 프로그램 랜딩(가격표 포함)이 / → /streamer 로 이설됨.
// 가격표 계약은 streamer.html을 검사한다 (index.html은 시청자 랜딩).
const publicIndexHtml = fs.readFileSync(path.join(root, "public/streamer.html"), "utf8");
const siteLoginHtml = fs.readFileSync(path.join(root, "public/login.html"), "utf8");
const siteCss = fs.readFileSync(path.join(root, "public/assets/site.css"), "utf8");
const siteJs = fs.readFileSync(path.join(root, "public/assets/site.js"), "utf8");

for (const id of requiredAdminIds) {
  if (!adminHtml.includes(`id="${id}"`)) {
    failures.push(`admin-private/index.html: required id missing: ${id}`);
  }
}

for (const className of requiredAdminCssClasses) {
  if (!adminHtml.includes(className) && !adminJs.includes(className)) {
    failures.push(`admin-private/index.html or admin-private/admin.js: required class missing: ${className}`);
  }
  if (!adminCss.includes(`.${className}`)) {
    failures.push(`admin-private/admin.css: required class style missing: ${className}`);
  }
}

const forbiddenJsLayouts = [
  "userDetailsContainer.style.display = \"block\"",
  "activeLicenseDetails.style.display = \"flex\"",
  "formSubmitBtn.className = \"button primary full-width\""
];

for (const fragment of forbiddenJsLayouts) {
  if (adminJs.includes(fragment)) {
    failures.push(`admin-private/admin.js: layout regression fragment present: ${fragment}`);
  }
}

if (!adminHtml.includes('<meta charset="utf-8"')) {
  failures.push("admin-private/index.html: utf-8 charset missing");
}

if (!adminHtml.includes("/admin/admin.js?v=20260614-admin-capslock1")) {
  failures.push("admin-private/index.html: versioned admin.js missing");
}
if (!adminHtml.includes("/admin/admin.css?v=20260614-admin-capslock1")) {
  failures.push("admin-private/index.html: versioned admin.css missing");
}

if (!adminJs.includes("alreadyVerified") || !adminJs.includes("refreshAuthenticatedSession")) {
  failures.push("admin-private/admin.js: auth refresh state-preservation guard missing");
}

if (!signupApi.includes("auth.admin.createUser") || !signupApi.includes("email_confirm: true")) {
  failures.push("api/auth-signup.ts: signup must create a password login-ready Supabase user");
}

if (signupApi.includes(".auth.signUp(")) {
  failures.push("api/auth-signup.ts: signup API must not create email-confirmation-pending users");
}

if (!siteJs.includes('apiJson("/api/auth-signup"') || siteJs.includes("state.supabase.auth.signUp({")) {
  failures.push("public/assets/site.js: signup must go through /api/auth-signup before browser sign-in");
}

if (!siteLoginHtml.includes('id="caps-lock-warning"')) {
  failures.push("public/login.html: Caps Lock warning element missing");
}

if (!siteJs.includes("setupCapsLockWarning") || !siteJs.includes("getModifierState(\"CapsLock\")")) {
  failures.push("public/assets/site.js: Caps Lock warning handler missing");
}

if (!siteCss.includes(".caps-lock-warning")) {
  failures.push("public/assets/site.css: Caps Lock warning styles missing");
}

if (!adminJs.includes("collapsedFolderCategories") || !adminJs.includes("setActiveFolderUser") || !adminJs.includes("folderLoadRequestId")) {
  failures.push("admin-private/admin.js: folder state preservation helpers missing");
}

if (!adminJs.includes("selectedFolderUserIds") || !adminJs.includes("/api/admin-license-bulk") || !adminJs.includes("moveSelectedFolderUsers")) {
  failures.push("admin-private/admin.js: folder bulk selection helpers missing");
}

if (!adminCss.includes("max-height: none") || !adminCss.includes("overflow-wrap: anywhere")) {
  failures.push("admin-private/admin.css: folder email visibility fixes missing");
}

if (!adminHtml.includes('<option value="day">일</option>') || !adminHtml.includes('<option value="hour">시간</option>')) {
  failures.push("admin-private/index.html: license code duration unit values must match API values day/hour");
}

if (adminHtml.includes('value="days"') || adminHtml.includes('value="hours"')) {
  failures.push("admin-private/index.html: plural duration unit values days/hours are invalid for /api/admin-license-code");
}

const pricingSection = publicIndexHtml.match(/<section id="pricing"[\s\S]*?<\/section>/)?.[0] || "";
const requiredPricingFragments = [
  "Standard",
  "100,000원",
  "시그니처 15개",
  "미디어 300MB",
  "금액별, 랭킹, 누적 후원자 시그니처",
  "벽지 기능",
  "영상 자동 최적화",
  "Windows 설치 파일 제공",
  "Pro",
  "250,000원",
  "시그니처 최대 50개",
  "미디어 1GB",
  "공유 코드 동기화",
  "1대 PC 기준 고급 세팅 사용",
  "커스텀 로고와 테마",
  "우선 기능 업데이트",
  "모든 기능 사용 가능",
  "시그니처 슬롯 추가",
  "1개당 +10,000원",
  "추가 미디어 용량 500MB",
  "+90,000원",
  "커스텀 시그니처 제작",
  "개당 +30,000원",
  "원하는 기능 추가 개발",
  "초기 세팅 대행"
];

for (const fragment of requiredPricingFragments) {
  if (!pricingSection.includes(fragment)) {
    failures.push(`public/index.html: pricing fragment missing: ${fragment}`);
  }
}

for (const removedFragment of ["Starter", "70,000원", "프리미엄 테마 제작", "개당 +10,000원부터"]) {
  if (pricingSection.includes(removedFragment)) {
    failures.push(`public/index.html: removed pricing fragment still present: ${removedFragment}`);
  }
}

const vercelConfig = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const routes = JSON.stringify(vercelConfig.routes || []);
for (const route of ["/admin/?", "/admin/index\\\\.html", "/admin/(admin\\\\.(js|css))"]) {
  if (!routes.includes(route)) {
    failures.push(`vercel.json: admin route missing: ${route}`);
  }
}

if (failures.length > 0) {
  console.error("Admin static check failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Admin static check passed");
