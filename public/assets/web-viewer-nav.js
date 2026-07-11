// =============================================================================
// 계이득 웹 — 시청자 공용 내비게이션 (세션 인지 계정 버튼 + 테마 토글 바인딩)
// 로드 순서: supabase-js CDN → web-common.js → web-viewer-nav.js (전부 defer)
//
// 점진적 향상(Progressive Enhancement) 원칙:
//   · GW/supabase가 없거나 site-config 로드가 실패하면 아무것도 바꾸지 않는다
//     (기존 "로그인" 링크가 그대로 동작).
//   · 로그인 상태면 #account-button 을 프로필 드롭다운 버튼으로 교체한다.
//   · 테마 토글은 .theme-toggle[data-vn-theme] 에만 바인딩한다 — 기존 페이지의
//     자체 바인딩 토글(index/channels/me)은 data-vn-theme 가 없어 건드리지 않는다.
// =============================================================================

(function () {
  "use strict";

  var THEME_KEY = "bbbb-site-theme";
  var CSS_HREF = "/assets/web-viewer-nav.css";

  ensureStylesheet();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    bindThemeToggles();
    upgradeAccountButton();
  }

  // ---------------------------------------------------------------------------
  // 드롭다운 스타일 주입 — 공유 계약(SHARED SCRIPTS)은 JS 태그만 요구하므로
  // CSS는 스크립트가 스스로 1회 주입한다(중복 방지 가드 포함).
  // ---------------------------------------------------------------------------

  function ensureStylesheet() {
    if (document.querySelector('link[href="' + CSS_HREF + '"]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = CSS_HREF;
    document.head.appendChild(link);
  }

  // ---------------------------------------------------------------------------
  // 테마 토글 — web-channels.js setupTheme 패턴 미러 (키·data-theme·aria-pressed)
  // data-vn-theme 표시가 있는 토글만, 이중 바인딩 가드 포함.
  // ---------------------------------------------------------------------------

  function bindThemeToggles() {
    var toggles = document.querySelectorAll(".theme-toggle[data-vn-theme]");
    Array.prototype.forEach.call(toggles, function (toggle) {
      if (toggle.dataset.vnThemeBound === "1") return;
      toggle.dataset.vnThemeBound = "1";

      var apply = function (theme) {
        var next = theme === "light" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem(THEME_KEY, next);
        } catch (err) {
          /* 저장 실패 시에도 화면 테마는 유지 */
        }
        var isDark = next === "dark";
        toggle.setAttribute("aria-pressed", String(isDark));
        var label = isDark ? "화이트 모드로 전환" : "다크 모드로 전환";
        toggle.setAttribute("aria-label", label);
        toggle.setAttribute("title", label);
      };

      apply(document.documentElement.dataset.theme);
      toggle.addEventListener("click", function () {
        apply(document.documentElement.dataset.theme === "dark" ? "light" : "dark");
      });
    });
  }

  // ---------------------------------------------------------------------------
  // 계정 버튼 — 로그아웃 상태면 손대지 않고, 로그인 상태면 드롭다운으로 교체
  // ---------------------------------------------------------------------------

  async function upgradeAccountButton() {
    var anchor = document.getElementById("account-button");
    if (!anchor || anchor.dataset.vnBound === "1") return;
    anchor.dataset.vnBound = "1";

    var GW = window.GW;
    if (!GW || typeof GW.getSession !== "function") return;

    var session = null;
    try {
      session = await GW.getSession();
    } catch (err) {
      return; // 세션 확인 실패 → 로그인 링크 유지
    }
    if (!session || !session.user) return;

    var name = await resolveDisplayName(GW, session);
    renderAccountMenu(anchor, name);
  }

  async function resolveDisplayName(GW, session) {
    var email = (session.user && session.user.email) || "";
    var fallback = email ? email.split("@")[0] : "내 계정";
    if (typeof GW.api === "function") {
      try {
        var profile = await GW.api("/api/me/profile", { token: session.access_token });
        if (profile && typeof profile.nickname === "string" && profile.nickname.trim()) {
          return profile.nickname.trim().slice(0, 20);
        }
      } catch (err) {
        /* 프로필 조회 실패 → 이메일 로컬파트 폴백 */
      }
    }
    return fallback.slice(0, 20);
  }

  function renderAccountMenu(anchor, name) {
    var esc =
      window.GW && typeof window.GW.escapeHtml === "function"
        ? window.GW.escapeHtml
        : function (value) {
            return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
              return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
            });
          };

    var wrap = document.createElement("div");
    wrap.className = "vn-account";
    wrap.innerHTML =
      '<button id="account-button" class="header-account vn-account-button" type="button" aria-haspopup="menu" aria-expanded="false">' +
      '<span class="vn-account-name">' + esc(name) + "</span>" +
      '<svg class="vn-caret" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg>' +
      "</button>" +
      '<div class="vn-menu" role="menu" aria-label="계정 메뉴" hidden>' +
      '<a class="vn-item" role="menuitem" href="/me">내 페이지</a>' +
      '<a class="vn-item" role="menuitem" href="/wallet">지갑 · 충전 <span class="vn-soon">준비 중</span></a>' +
      '<a class="vn-item" role="menuitem" href="/guide">이용 가이드</a>' +
      '<div class="vn-divider" role="separator"></div>' +
      '<button class="vn-item vn-logout" role="menuitem" type="button">로그아웃</button>' +
      "</div>";

    anchor.replaceWith(wrap);

    var button = wrap.querySelector(".vn-account-button");
    var menu = wrap.querySelector(".vn-menu");
    var logout = wrap.querySelector(".vn-logout");

    function setOpen(open) {
      menu.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
    }

    function close(refocus) {
      if (menu.hidden) return;
      setOpen(false);
      if (refocus) button.focus();
    }

    button.addEventListener("click", function () {
      if (menu.hidden) {
        setOpen(true);
        var first = menu.querySelector(".vn-item");
        if (first) first.focus();
      } else {
        close(true);
      }
    });

    // 바깥 클릭 → 닫기 (버튼/메뉴 내부 클릭은 유지)
    document.addEventListener("click", function (event) {
      if (menu.hidden) return;
      if (!wrap.contains(event.target)) close(false);
    });

    // Esc → 닫고 포커스를 버튼으로 복귀
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") close(true);
    });

    // 메뉴 내 화살표 이동(순환)
    menu.addEventListener("keydown", function (event) {
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      event.preventDefault();
      var items = Array.prototype.slice.call(menu.querySelectorAll(".vn-item"));
      if (!items.length) return;
      var idx = items.indexOf(document.activeElement);
      var next = event.key === "ArrowDown" ? idx + 1 : idx - 1;
      if (next < 0) next = items.length - 1;
      if (next >= items.length) next = 0;
      items[next].focus();
    });

    logout.addEventListener("click", async function () {
      logout.disabled = true;
      try {
        var GW = window.GW;
        if (GW && typeof GW.getClient === "function") {
          var supa = await GW.getClient();
          if (supa && supa.auth && typeof supa.auth.signOut === "function") {
            await supa.auth.signOut();
          }
        }
      } catch (err) {
        /* 로그아웃 실패해도 새로고침으로 세션 상태를 재평가 */
      }
      location.reload();
    });
  }
})();
