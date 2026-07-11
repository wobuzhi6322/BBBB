#!/usr/bin/env node
// =============================================================================
// 계이득 릴레이 사이트 — 정적 계약 검사기 (standalone relay-site 전용)
//
// package.json "check" 스크립트가 tsc --noEmit 다음에 실행한다.
// 위반이 하나라도 있으면 각 건을 FAIL: 로 출력하고 exit 1.
//
// 검사 계약:
//   1. vercel.json — 파싱 가능, /@handle(/d/:id) 라우트 → /api/channel-page,
//      admin 참조 0건, functions["api/channel-page.ts"].includeFiles에
//      public/channel.html 포함.
//   2. api/channel-page.ts · api/_webServer.ts 존재.
//   3. public/ 필수 페이지 9종 — viewport 메타, favicon, site.css → web-tokens.css
//      링크 순서, 삭제된 /assets/site.js·사이트 admin 화면 참조 금지.
//      * "admin" 검사 범위: href/src/action 속성값, admin.html, /api/admin 참조만
//        위반으로 본다. studio.html의 "프로그램 관리 화면(/admin)" 같은 본문 카피는
//        데스크톱 프로그램의 로컬 관리 화면 안내(페어링 절차)라서 정상이다.
//   4. api/ 하위 어떤 파일도 삭제된 모듈(admin*, shared-code, shared-profile,
//      account, devices/register, releases)을 import하지 않는다.
//   5. (정보성) api/ 안 BBBB_SHARED_ADMIN_TOKEN 사용처 스캔 — 없으면 env 불필요 안내.
// =============================================================================

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const failures = [];
const infos = [];

function fail(message) {
  failures.push(message);
}

function info(message) {
  infos.push(message);
}

function readTextIfExists(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

// ---------------------------------------------------------------------------
// 1. vercel.json
// ---------------------------------------------------------------------------

function checkVercelJson() {
  const raw = readTextIfExists("vercel.json");
  if (raw === null) {
    fail("vercel.json: 파일이 없습니다");
    return;
  }

  let json;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    fail(`vercel.json: JSON 파싱 실패 — ${err.message}`);
    return;
  }

  // admin 참조 금지 — routes 배열 포함 파일 전체를 본다 (functions 키 등 포함).
  const adminLine = raw.split(/\r?\n/).find((line) => /admin/i.test(line));
  if (adminLine !== undefined) {
    fail(`vercel.json: admin 참조가 남아 있습니다 — "${adminLine.trim()}"`);
  }

  const routes = Array.isArray(json.routes) ? json.routes : null;
  if (!routes) {
    fail("vercel.json: routes 배열이 없습니다");
  } else {
    // /@handle/d/:messageId → /api/channel-page
    const detailRoute = routes.find(
      (r) => r && typeof r.src === "string" && r.src.includes("/@([^/]+)/d/")
    );
    if (!detailRoute) {
      fail('vercel.json: "/@([^/]+)/d/..." (후원 메시지 상세) 라우트가 없습니다');
    } else if (
      typeof detailRoute.dest !== "string" ||
      !detailRoute.dest.startsWith("/api/channel-page")
    ) {
      fail(
        `vercel.json: /@handle/d/ 라우트 dest가 /api/channel-page가 아닙니다 (현재: ${JSON.stringify(detailRoute.dest)})`
      );
    }

    // /@handle → /api/channel-page
    const handleRoute = routes.find(
      (r) =>
        r &&
        typeof r.src === "string" &&
        r.src.includes("/@([^/]+)") &&
        !r.src.includes("/d/")
    );
    if (!handleRoute) {
      fail('vercel.json: "/@([^/]+)" (채널 페이지) 라우트가 없습니다');
    } else if (
      typeof handleRoute.dest !== "string" ||
      !handleRoute.dest.startsWith("/api/channel-page")
    ) {
      fail(
        `vercel.json: /@handle 라우트 dest가 /api/channel-page가 아닙니다 (현재: ${JSON.stringify(handleRoute.dest)})`
      );
    }
  }

  // functions["api/channel-page.ts"].includeFiles 에 public/channel.html 포함
  const fn = json.functions && json.functions["api/channel-page.ts"];
  if (!fn) {
    fail('vercel.json: functions["api/channel-page.ts"] 항목이 없습니다');
  } else {
    const inc = fn.includeFiles;
    const includesTemplate =
      inc === "public/channel.html" ||
      (typeof inc === "string" &&
        inc.split(",").map((s) => s.trim()).includes("public/channel.html")) ||
      (Array.isArray(inc) && inc.includes("public/channel.html"));
    if (!includesTemplate) {
      fail(
        `vercel.json: functions["api/channel-page.ts"].includeFiles에 public/channel.html이 없습니다 (현재: ${JSON.stringify(inc)})`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 2. 필수 api 파일 존재
// ---------------------------------------------------------------------------

function checkRequiredApiFiles() {
  for (const rel of ["api/channel-page.ts", "api/_webServer.ts"]) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      fail(`${rel}: 필수 파일이 없습니다`);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. public/ 페이지 계약
// ---------------------------------------------------------------------------

const REQUIRED_PAGES = [
  "index.html",
  "login.html",
  "signup.html",
  "channel.html",
  "channels.html",
  "me.html",
  "studio.html",
  "terms.html",
  "privacy.html"
];

function checkPage(pageName) {
  const rel = `public/${pageName}`;
  const html = readTextIfExists(rel);
  if (html === null) {
    fail(`${rel}: 파일이 없습니다 (최종 상태 필수 페이지)`);
    return;
  }

  if (!/<meta\s[^>]*name="viewport"/i.test(html)) {
    fail(`${rel}: <meta name="viewport"> 가 없습니다`);
  }

  if (!/<link\s[^>]*rel="icon"/i.test(html)) {
    fail(`${rel}: <link rel="icon"> 파비콘이 없습니다`);
  }

  const siteIdx = html.indexOf("/assets/site.css");
  const tokensIdx = html.indexOf("/assets/web-tokens.css");
  if (siteIdx === -1) {
    fail(`${rel}: /assets/site.css 링크가 없습니다`);
  }
  if (tokensIdx === -1) {
    fail(`${rel}: /assets/web-tokens.css 링크가 없습니다`);
  }
  if (siteIdx !== -1 && tokensIdx !== -1 && tokensIdx < siteIdx) {
    fail(`${rel}: /assets/web-tokens.css는 /assets/site.css 뒤에 링크해야 합니다 (토큰 브리지가 나중에 로드돼야 함)`);
  }

  if (html.includes("/assets/site.js")) {
    fail(`${rel}: 삭제된 /assets/site.js 를 참조합니다`);
  }

  // 사이트 admin 화면 참조 금지 — 링크 표면(href/src/action)과 admin.html,
  // /api/admin 만 검사한다. 본문 카피의 "프로그램 관리 화면(/admin)"은
  // 데스크톱 프로그램 로컬 화면 안내라서 위반이 아니다(파일 상단 주석 참조).
  const attrRe = /(?:href|src|action)\s*=\s*"([^"]*)"/gi;
  let attrMatch;
  while ((attrMatch = attrRe.exec(html)) !== null) {
    if (/admin/i.test(attrMatch[1])) {
      fail(`${rel}: admin을 가리키는 링크/리소스 참조 — ${attrMatch[0]}`);
    }
  }
  if (/admin\.html/i.test(html)) {
    fail(`${rel}: 삭제된 admin.html 을 참조합니다`);
  }
  if (/\/api\/admin/i.test(html)) {
    fail(`${rel}: 삭제된 /api/admin* 엔드포인트를 참조합니다`);
  }
}

// ---------------------------------------------------------------------------
// 4. api/ 임포트 스캔 — 삭제된 모듈 참조 금지
// ---------------------------------------------------------------------------

function walkTsFiles(dirAbs, acc) {
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const abs = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(abs, acc);
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      acc.push(abs);
    }
  }
  return acc;
}

function extractImportSpecifiers(source) {
  const specs = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g, // import ... from / export ... from
    /\bimport\s+["']([^"']+)["']/g, // side-effect import
    /\brequire\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

// 삭제된 프로그램 사이트 모듈 — 세그먼트 단위 매치 (확장자 제거 후 비교)
const DELETED_SEGMENTS = new Set(["shared-code", "shared-profile", "account", "releases"]);

function isDeletedModule(spec) {
  const segments = spec
    .replace(/\\/g, "/")
    .split("/")
    .filter((s) => s !== "" && s !== "." && s !== "..")
    .map((s) => s.replace(/\.(?:js|mjs|cjs|ts)$/i, ""));
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (DELETED_SEGMENTS.has(seg)) return true;
    if (/^_?admin/i.test(seg)) return true; // admin, admin-*, _admin* 전부
    if (seg === "devices" && i + 1 < segments.length && /^register/i.test(segments[i + 1])) {
      return true; // devices/register
    }
  }
  return false;
}

function checkApiImports() {
  const apiDir = path.join(ROOT, "api");
  if (!fs.existsSync(apiDir)) {
    fail("api/: 디렉터리가 없습니다");
    return [];
  }
  const files = walkTsFiles(apiDir, []);
  for (const abs of files) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    const source = fs.readFileSync(abs, "utf8");
    for (const spec of extractImportSpecifiers(source)) {
      if (isDeletedModule(spec)) {
        fail(`${rel}: 삭제된 모듈을 import합니다 — "${spec}"`);
      }
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// 5. (정보성) BBBB_SHARED_ADMIN_TOKEN 사용처 스캔
// ---------------------------------------------------------------------------

function checkSharedAdminToken(apiFiles) {
  const usages = [];
  for (const abs of apiFiles) {
    const rel = path.relative(ROOT, abs).replace(/\\/g, "/");
    const lines = fs.readFileSync(abs, "utf8").split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.includes("BBBB_SHARED_ADMIN_TOKEN")) {
        usages.push(`${rel}:${idx + 1}`);
      }
    });
  }
  if (usages.length === 0) {
    info("BBBB_SHARED_ADMIN_TOKEN: api/ 사용처 없음 — 새 Vercel 프로젝트에 이 env 변수는 불필요");
  } else {
    info(`BBBB_SHARED_ADMIN_TOKEN: 사용처 발견 — ${usages.join(", ")} (env 유지 필요)`);
  }
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

checkVercelJson();
checkRequiredApiFiles();
for (const page of REQUIRED_PAGES) checkPage(page);
const apiFiles = checkApiImports();
checkSharedAdminToken(apiFiles);

for (const line of infos) console.log(`INFO: ${line}`);

if (failures.length > 0) {
  for (const line of failures) console.error(`FAIL: ${line}`);
  console.error(`\ncheck-web-static: ${failures.length}건 위반 — 위 FAIL 항목을 수정하세요.`);
  process.exit(1);
}

console.log(
  `check-web-static: OK — vercel.json 라우팅, 페이지 ${REQUIRED_PAGES.length}종 계약, api 임포트(${apiFiles.length}파일) 모두 통과`
);
