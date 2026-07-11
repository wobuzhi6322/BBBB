#!/usr/bin/env node
// =============================================================================
// 계이득 통합 사이트(gaeideuk.com) — 웹 플랫폼 정적 계약 검사기
//
// package.json "check" 스크립트가 tsc --noEmit → check-admin-static.cjs 다음에
// 실행한다. 위반이 하나라도 있으면 각 건을 FAIL: 로 출력하고 exit 1.
//
// 이 저장소는 relay-site(분리 배포안)와 달리 "통합" 저장소다:
//   · admin(admin-private/ + /api/admin*)이 존재하고 살아 있어야 한다.
//   · /assets/site.js 는 프로그램 로그인·계정 기계장치로 **합법**이다(금지 아님).
//   · / 는 시청자 랜딩, /streamer 는 이전된 프로그램 랜딩, /login 은 시청자/스트리머 겸용.
//
// 검사 계약:
//   1. vercel.json — legacy routes 문법. admin 라우트 3종 유지(/admin/? →
//      /api/admin 등), /@handle/d/:id → /api/channel-page 가 /@handle 보다 먼저,
//      /streamer → /streamer.html, functions includeFiles에 public/channel.html +
//      admin-private 항목 유지.
//   2. api/channel-page.ts · api/_webServer.ts 존재.
//   3. 웹 페이지 5종(channel/channels/me/signup/studio) — viewport, favicon,
//      site.css → web-tokens.css → 페이지 web-*.css 링크 순서, admin 링크 표면 금지.
//      * "admin" 검사 범위: href/src/action 속성값, admin.html, /api/admin 만.
//        본문 카피의 "프로그램 관리 화면(/admin)" 안내는 위반이 아니다.
//   4. 프로그램 페이지 3종(index/streamer/login) — viewport, favicon.
//      site.js·admin 링크는 합법(site.js 헤더가 /admin/ 링크를 렌더링한다).
//      login.html 은 site.js(프로그램 로그인) + web-viewer-login.js(시청자 탭) 둘 다,
//      streamer.html 은 site.js(라이선스 게이트 로그인 기계장치)를 반드시 포함.
//   5. 전 페이지 — /assets/v2.css 참조 금지(relay-site 분리안의 베이스 CSS 유출 방지).
//   6. api/ 하위 상대 import 가 실존 모듈로 해소되는지 스캔(존재하지 않는 모듈 금지).
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
// 1. vercel.json — legacy routes 문법 계약
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

  const routes = Array.isArray(json.routes) ? json.routes : null;
  if (!routes) {
    fail("vercel.json: routes 배열(legacy 문법)이 없습니다");
  } else {
    const findRoute = (predicate) => {
      const idx = routes.findIndex(
        (r) => r && typeof r.src === "string" && predicate(r)
      );
      return idx === -1 ? null : { route: routes[idx], idx };
    };
    const destStartsWith = (r, prefix) =>
      typeof r.dest === "string" && r.dest.startsWith(prefix);

    // --- admin 라우트 3종 유지 (프로그램 관리 화면 — 깨지면 안 됨) ---
    const adminRoot = findRoute((r) => r.src === "/admin/?");
    if (!adminRoot) {
      fail('vercel.json: "/admin/?" 라우트가 없습니다 (admin 진입 깨짐)');
    } else if (!destStartsWith(adminRoot.route, "/api/admin")) {
      fail(
        `vercel.json: "/admin/?" dest가 /api/admin이 아닙니다 (현재: ${JSON.stringify(adminRoot.route.dest)})`
      );
    }

    const adminIndex = findRoute((r) => r.src === "/admin/index\\.html");
    if (!adminIndex) {
      fail('vercel.json: "/admin/index\\.html" 라우트가 없습니다');
    } else if (!destStartsWith(adminIndex.route, "/api/admin")) {
      fail(
        `vercel.json: "/admin/index\\.html" dest가 /api/admin이 아닙니다 (현재: ${JSON.stringify(adminIndex.route.dest)})`
      );
    }

    const adminAsset = findRoute((r) => r.src.includes("admin\\.(js|css)"));
    if (!adminAsset) {
      fail('vercel.json: "/admin/(admin\\.(js|css))" 에셋 라우트가 없습니다');
    } else if (!destStartsWith(adminAsset.route, "/api/admin-asset")) {
      fail(
        `vercel.json: admin 에셋 라우트 dest가 /api/admin-asset이 아닙니다 (현재: ${JSON.stringify(adminAsset.route.dest)})`
      );
    }

    // --- /@handle/d/:messageId → /api/channel-page (상세 라우트가 먼저) ---
    const detail = findRoute((r) => r.src.includes("/@([^/]+)/d/"));
    if (!detail) {
      fail('vercel.json: "/@([^/]+)/d/..." (후원 메시지 상세) 라우트가 없습니다');
    } else if (!destStartsWith(detail.route, "/api/channel-page")) {
      fail(
        `vercel.json: /@handle/d/ 라우트 dest가 /api/channel-page가 아닙니다 (현재: ${JSON.stringify(detail.route.dest)})`
      );
    }

    const handle = findRoute(
      (r) => r.src.includes("/@([^/]+)") && !r.src.includes("/d/")
    );
    if (!handle) {
      fail('vercel.json: "/@([^/]+)" (채널 페이지) 라우트가 없습니다');
    } else if (!destStartsWith(handle.route, "/api/channel-page")) {
      fail(
        `vercel.json: /@handle 라우트 dest가 /api/channel-page가 아닙니다 (현재: ${JSON.stringify(handle.route.dest)})`
      );
    }

    if (detail && handle && detail.idx > handle.idx) {
      fail(
        "vercel.json: /@handle/d/:id 상세 라우트가 /@handle 라우트보다 뒤에 있습니다 — 상세 라우트를 먼저 두어야 합니다"
      );
    }

    // --- /streamer → /streamer.html (이전된 프로그램 랜딩) ---
    const streamer = findRoute((r) => /^\/streamer(\/\?|\/?\??)?$/.test(r.src));
    if (!streamer) {
      fail('vercel.json: "/streamer" 라우트가 없습니다 (이전된 프로그램 랜딩 접근 불가)');
    } else if (streamer.route.dest !== "/streamer.html") {
      fail(
        `vercel.json: /streamer 라우트 dest가 /streamer.html이 아닙니다 (현재: ${JSON.stringify(streamer.route.dest)})`
      );
    }
  }

  // --- functions includeFiles ---
  const includesFile = (inc, wanted) =>
    inc === wanted ||
    (typeof inc === "string" &&
      inc.split(",").map((s) => s.trim()).includes(wanted)) ||
    (Array.isArray(inc) && inc.includes(wanted));

  const fnChannel = json.functions && json.functions["api/channel-page.ts"];
  if (!fnChannel) {
    fail('vercel.json: functions["api/channel-page.ts"] 항목이 없습니다');
  } else if (!includesFile(fnChannel.includeFiles, "public/channel.html")) {
    fail(
      `vercel.json: functions["api/channel-page.ts"].includeFiles에 public/channel.html이 없습니다 (현재: ${JSON.stringify(fnChannel.includeFiles)})`
    );
  }

  const fnAdmin = json.functions && json.functions["api/admin.ts"];
  if (!fnAdmin) {
    fail('vercel.json: functions["api/admin.ts"] 항목이 없습니다 (admin SSR 깨짐)');
  } else if (!includesFile(fnAdmin.includeFiles, "admin-private/index.html")) {
    fail(
      `vercel.json: functions["api/admin.ts"].includeFiles에 admin-private/index.html이 없습니다 (현재: ${JSON.stringify(fnAdmin.includeFiles)})`
    );
  }

  const fnAdminAsset = json.functions && json.functions["api/admin-asset.ts"];
  if (!fnAdminAsset) {
    fail('vercel.json: functions["api/admin-asset.ts"] 항목이 없습니다 (admin 에셋 깨짐)');
  } else if (!includesFile(fnAdminAsset.includeFiles, "admin-private/**")) {
    fail(
      `vercel.json: functions["api/admin-asset.ts"].includeFiles에 admin-private/**가 없습니다 (현재: ${JSON.stringify(fnAdminAsset.includeFiles)})`
    );
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
// 3·4·5. public/ 페이지 계약
// ---------------------------------------------------------------------------

// 웹 플랫폼 페이지 — site.css → web-tokens.css → 페이지 web-*.css, admin 링크 금지
const WEB_PAGES = ["channel.html", "channels.html", "me.html", "signup.html", "studio.html"];
// 프로그램 계열 페이지 — index=시청자 랜딩, streamer=이전된 프로그램 랜딩, login=겸용.
// site.js 합법(헤더가 /admin/ 링크를 렌더링), admin 링크 검사 제외.
const PROGRAM_PAGES = ["index.html", "streamer.html", "login.html"];

function checkPageCommon(rel, html) {
  if (!/<meta\s[^>]*name="viewport"/i.test(html)) {
    fail(`${rel}: <meta name="viewport"> 가 없습니다`);
  }
  if (!/<link\s[^>]*rel="(?:shortcut )?icon"/i.test(html)) {
    fail(`${rel}: <link rel="icon"> 파비콘이 없습니다`);
  }
  if (html.includes("/assets/v2.css")) {
    fail(`${rel}: /assets/v2.css 를 참조합니다 — relay-site 분리안의 베이스 CSS가 이 저장소에 유출되면 안 됩니다`);
  }
}

function checkWebPage(pageName) {
  const rel = `public/${pageName}`;
  const html = readTextIfExists(rel);
  if (html === null) {
    fail(`${rel}: 파일이 없습니다 (웹 플랫폼 필수 페이지)`);
    return;
  }

  checkPageCommon(rel, html);

  // CSS 링크 순서: site.css → web-tokens.css → 페이지 web-*.css
  const siteIdx = html.indexOf("/assets/site.css");
  const tokensIdx = html.indexOf("/assets/web-tokens.css");
  if (siteIdx === -1) {
    fail(`${rel}: /assets/site.css 링크가 없습니다 (D-reskin 디자인 토큰 베이스)`);
  }
  if (tokensIdx === -1) {
    fail(`${rel}: /assets/web-tokens.css 링크가 없습니다 (웹 토큰 브리지)`);
  }
  if (siteIdx !== -1 && tokensIdx !== -1 && tokensIdx < siteIdx) {
    fail(`${rel}: /assets/web-tokens.css는 /assets/site.css 뒤에 링크해야 합니다 (토큰 브리지가 나중에 로드돼야 함)`);
  }

  const pageCssRe = /\/assets\/web-([A-Za-z0-9-]+)\.css/g;
  let pageCssCount = 0;
  let m;
  while ((m = pageCssRe.exec(html)) !== null) {
    if (m[1] === "tokens") continue;
    pageCssCount += 1;
    if (tokensIdx !== -1 && m.index < tokensIdx) {
      fail(`${rel}: 페이지 CSS(/assets/web-${m[1]}.css)가 /assets/web-tokens.css보다 먼저 링크돼 있습니다`);
    }
  }
  if (pageCssCount === 0) {
    fail(`${rel}: 페이지 전용 /assets/web-*.css 링크가 없습니다 (web-tokens.css 뒤에 와야 함)`);
  }

  // admin 참조 금지 — 링크 표면(href/src/action)과 admin.html, /api/admin 만 검사.
  // 본문 카피의 "프로그램 관리 화면(/admin)" 안내(페어링 절차)는 위반이 아니다.
  const attrRe = /(?:href|src|action)\s*=\s*"([^"]*)"/gi;
  let attrMatch;
  while ((attrMatch = attrRe.exec(html)) !== null) {
    if (/admin/i.test(attrMatch[1])) {
      fail(`${rel}: admin을 가리키는 링크/리소스 참조 — ${attrMatch[0]}`);
    }
  }
  if (/admin\.html/i.test(html)) {
    fail(`${rel}: admin.html 을 참조합니다`);
  }
  if (/\/api\/admin/i.test(html)) {
    fail(`${rel}: /api/admin* 엔드포인트를 참조합니다`);
  }
}

function checkProgramPage(pageName) {
  const rel = `public/${pageName}`;
  const html = readTextIfExists(rel);
  if (html === null) {
    fail(`${rel}: 파일이 없습니다 (필수 페이지 — index=시청자 랜딩, streamer=프로그램 랜딩, login=겸용 로그인)`);
    return;
  }

  checkPageCommon(rel, html);

  if (pageName === "login.html") {
    if (!html.includes("/assets/site.js")) {
      fail(`${rel}: /assets/site.js 가 없습니다 — 스트리머(프로그램) 로그인 기계장치가 빠지면 라이선스 로그인이 깨집니다`);
    }
    if (!html.includes("/assets/web-viewer-login.js")) {
      fail(`${rel}: /assets/web-viewer-login.js 가 없습니다 — 시청자 로그인 탭 스크립트 누락`);
    }
  }

  if (pageName === "streamer.html") {
    if (!html.includes("/assets/site.js")) {
      fail(`${rel}: /assets/site.js 가 없습니다 — 이전된 프로그램 랜딩은 오늘과 동일하게 동작해야 합니다`);
    }
  }
}

// ---------------------------------------------------------------------------
// 6. api/ 상대 import 스캔 — 존재하지 않는 모듈 참조 금지
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

function relativeSpecResolves(importerAbs, spec) {
  const base = path.resolve(path.dirname(importerAbs), spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    base.replace(/\.js$/i, ".ts"),
    base.replace(/\.mjs$/i, ".mts"),
    path.join(base, "index.ts")
  ];
  return candidates.some((c) => fs.existsSync(c) && fs.statSync(c).isFile());
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
      if (!spec.startsWith(".")) continue; // 패키지·node: 빌트인은 tsc가 검증
      if (!relativeSpecResolves(abs, spec)) {
        fail(`${rel}: 존재하지 않는 모듈을 import합니다 — "${spec}"`);
      }
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------

checkVercelJson();
checkRequiredApiFiles();
for (const page of WEB_PAGES) checkWebPage(page);
for (const page of PROGRAM_PAGES) checkProgramPage(page);
const apiFiles = checkApiImports();

for (const line of infos) console.log(`INFO: ${line}`);

if (failures.length > 0) {
  for (const line of failures) console.error(`FAIL: ${line}`);
  console.error(`\ncheck-web-static: ${failures.length}건 위반 — 위 FAIL 항목을 수정하세요.`);
  process.exit(1);
}

console.log(
  `check-web-static: OK — vercel.json 라우팅(admin/@handle/streamer), 웹 페이지 ${WEB_PAGES.length}종 + 프로그램 페이지 ${PROGRAM_PAGES.length}종 계약, api 임포트(${apiFiles.length}파일) 모두 통과`
);
