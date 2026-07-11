// =============================================================================
// 계이득 웹 — /login 역할 탭 + 시청자 로그인 (role-split login 레인)
// 로드 순서: supabase-js CDN → web-common.js(GW.*) → web-viewer-login.js → site.js(module)
//
// 이 파일이 하는 일 두 가지:
// 1) [시청자]|[스트리머] 탭 전환 — show/hide(hidden 속성)만 수행한다.
//    스트리머 패널 내부의 #login-form/#email/#password 등은 site.js(읽기 전용)가
//    ID로 바인딩하므로 마크업을 절대 만지지 않는다. 딥링크 /login#streamer 지원.
// 2) 시청자 로그인 — supabase signInWithPassword 후 roles 기반 랜딩(/studio | /me).
//
// ⚠ 핵심 설계 메모(경합 방지):
// site.js는 같은 페이지에서 기본 storageKey(sb-<ref>-auth-token)로 만든 자체
// supabase 클라이언트의 onAuthStateChange를 구독한다. supabase-js v2는 로그인 시
// storageKey와 같은 이름의 BroadcastChannel로 SIGNED_IN을 방송하므로, 시청자
// 로그인을 기본 키 클라이언트로 수행하면 site.js가 이를 수신해 renderSession()
// → navigateToProfile() → /profile.html 로 강제 이동시켜 시청자 랜딩을 덮어쓴다.
// 그래서 시청자 로그인은 (a) 전용 storageKey + persistSession:false 인 "프로브"
// 클라이언트로 인증하고(방송·저장 없음), (b) 랜딩 결정 후 기본 storageKey에
// 세션 JSON을 직접 기록한 뒤 이동한다. 같은 탭에서는 localStorage 직접 기록이
// storage 이벤트를 발생시키지 않으므로 site.js는 끝까지 개입하지 못하고,
// 목적지(/me·/studio)의 GW.getClient()는 기본 키에서 세션을 그대로 복원한다.
// =============================================================================

(function () {
  "use strict";

  var PROBE_STORAGE_KEY = "gw-viewer-login-probe";

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  function boot() {
    var tabsApi = initRoleTabs();
    initViewerForm();
    initResetLink(tabsApi);
  }

  // ---------------------------------------------------------------------------
  // 역할 탭 — GW/supabase 없이도 항상 동작해야 한다(스트리머 로그인 접근성 보장)
  // ---------------------------------------------------------------------------

  function initRoleTabs() {
    var tabs = {
      viewer: document.getElementById("login-tab-viewer"),
      streamer: document.getElementById("login-tab-streamer")
    };
    var panels = {
      viewer: document.getElementById("login-panel-viewer"),
      streamer: document.getElementById("login-panel-streamer")
    };
    if (!tabs.viewer || !tabs.streamer || !panels.viewer || !panels.streamer) {
      return null;
    }

    function activate(role, focusTab) {
      var names = ["viewer", "streamer"];
      for (var i = 0; i < names.length; i += 1) {
        var name = names[i];
        var selected = name === role;
        tabs[name].classList.toggle("is-active", selected);
        tabs[name].setAttribute("aria-selected", selected ? "true" : "false");
        tabs[name].tabIndex = selected ? 0 : -1;
        panels[name].hidden = !selected;
      }
      if (focusTab) {
        tabs[role].focus();
      }
    }

    tabs.viewer.addEventListener("click", function () {
      activate("viewer");
    });
    tabs.streamer.addEventListener("click", function () {
      activate("streamer");
    });

    // WAI-ARIA Tabs: 좌우 화살표로 탭 이동
    [tabs.viewer, tabs.streamer].forEach(function (tab) {
      tab.addEventListener("keydown", function (event) {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
          return;
        }
        event.preventDefault();
        activate(tab === tabs.viewer ? "streamer" : "viewer", true);
      });
    });

    // 딥링크: /login#streamer → 스트리머 탭.
    // #login(기존 프로그램 로그인 해시)과 비밀번호 재설정 메일(type=recovery)도
    // 스트리머 폼(site.js의 복구 UI)이 처리하므로 스트리머 탭을 연다.
    function roleFromLocation() {
      var hash = window.location.hash || "";
      if (hash === "#streamer" || hash === "#login") {
        return "streamer";
      }
      if (hash === "#viewer") {
        return "viewer";
      }
      var hashParams = new URLSearchParams(hash.replace(/^#/, ""));
      var searchParams = new URLSearchParams(window.location.search);
      if (hashParams.get("type") === "recovery" || searchParams.get("type") === "recovery") {
        return "streamer";
      }
      return null;
    }

    var initial = roleFromLocation();
    if (initial) {
      activate(initial); // 마크업 기본값은 시청자 탭
    }
    window.addEventListener("hashchange", function () {
      var role = roleFromLocation();
      if (role) {
        activate(role);
      }
    });

    return { activate: activate };
  }

  // '비밀번호 재설정' 링크: 스트리머 탭의 기존 복구 흐름(비밀번호 찾기 버튼)으로 안내
  function initResetLink(tabsApi) {
    var link = document.getElementById("viewer-login-reset-link");
    if (!link) {
      return;
    }
    link.addEventListener("click", function () {
      window.setTimeout(function () {
        if (tabsApi) {
          tabsApi.activate("streamer");
        }
        var streamerEmail = document.getElementById("email");
        if (streamerEmail) {
          streamerEmail.focus();
        }
        // site.js 소유 메시지 영역에 안내만 기록(요소 자체는 건드리지 않음)
        var authMessage = document.getElementById("auth-message");
        if (authMessage && !authMessage.textContent) {
          authMessage.textContent = "이메일을 입력한 뒤 '비밀번호 찾기' 버튼을 눌러 주세요.";
        }
      }, 0);
    });
  }

  // ---------------------------------------------------------------------------
  // 시청자 로그인
  // ---------------------------------------------------------------------------

  function initViewerForm() {
    var form = document.getElementById("viewer-login-form");
    var email = document.getElementById("viewer-login-email");
    var password = document.getElementById("viewer-login-password");
    var submit = document.getElementById("viewer-login-submit");
    var message = document.getElementById("viewer-login-message");
    if (!form || !email || !password) {
      return;
    }

    function say(text) {
      if (message) {
        message.textContent = text || "";
      }
    }

    form.addEventListener("submit", async function (event) {
      event.preventDefault();
      var GW = window.GW;
      var emailValue = email.value.trim();
      var passwordValue = password.value;
      if (!emailValue) {
        say("이메일을 입력해 주세요.");
        email.focus();
        return;
      }
      if (!passwordValue) {
        say("비밀번호를 입력해 주세요.");
        password.focus();
        return;
      }
      if (!GW) {
        say("페이지 스크립트를 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.");
        return;
      }

      if (submit) {
        submit.disabled = true;
      }
      say("로그인 중입니다…");
      try {
        var probe = await createProbeClient();
        if (!probe) {
          say("지금은 로그인할 수 없어요. 잠시 후 다시 시도해 주세요.");
          return;
        }
        var result = await probe.auth.signInWithPassword({ email: emailValue, password: passwordValue });
        if (result.error) {
          say(koreanAuthError(result.error));
          return;
        }
        var session = result.data && result.data.session;
        if (!session) {
          say("로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.");
          return;
        }

        // 랜딩 결정: 스트리머 페이지 소유(roles: streamer) → /studio, 그 외 → /me.
        // ?next= 는 GW.safeNext로 내부 경로만 허용.
        var profile = null;
        try {
          profile = await GW.api("/api/me/profile", { token: session.access_token });
        } catch (err) {
          profile = null; // 프로필 조회 실패는 시청자 랜딩(/me)으로 진행
        }
        var target = GW.safeNext(hasStreamerRole(profile) ? "/studio" : "/me");

        say("로그인되었습니다. 이동 중입니다…");
        await persistSession(session);
        window.location.href = target;
      } catch (err) {
        say(koreanAuthError(err));
      } finally {
        if (submit) {
          submit.disabled = false;
        }
      }
    });
  }

  function hasStreamerRole(profile) {
    return Boolean(profile && Array.isArray(profile.roles) && profile.roles.indexOf("streamer") >= 0);
  }

  /** 방송·저장 없는 인증 전용 클라이언트 (파일 상단 설계 메모 참고) */
  async function createProbeClient() {
    var config = await window.GW.loadConfig();
    var supa = config && (config.supabase || config);
    if (!supa || !supa.url || !supa.anonKey || !window.supabase || !window.supabase.createClient) {
      return null;
    }
    return window.supabase.createClient(supa.url, supa.anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: PROBE_STORAGE_KEY
      }
    });
  }

  /**
   * 세션을 기본 storageKey에 직접 기록한다(방송 없음 → site.js 개입 차단).
   * supabase-js v2의 _saveSession과 동일하게 세션 객체 JSON을 그대로 저장하며,
   * 목적지 페이지의 GW.getClient()가 이를 복원한다.
   */
  async function persistSession(session) {
    var GW = window.GW;
    var client = null;
    try {
      client = await GW.getClient();
    } catch (err) {
      client = null;
    }

    // 1순위: 실제 공유 클라이언트가 쓰는 storageKey (런타임 프로퍼티)
    var storageKey =
      client && client.auth && typeof client.auth.storageKey === "string" ? client.auth.storageKey : null;

    // 2순위: supabase-js v2 기본 키 규칙(sb-<host 첫 라벨>-auth-token)으로 유도
    if (!storageKey) {
      try {
        var config = await GW.loadConfig();
        var supa = config && (config.supabase || config);
        if (supa && supa.url) {
          storageKey = "sb-" + new URL(supa.url).hostname.split(".")[0] + "-auth-token";
        }
      } catch (err) {
        storageKey = null;
      }
    }

    if (storageKey) {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(session));
        return;
      } catch (err) {
        /* 저장 실패(프라이빗 모드 등) → setSession 폴백 */
      }
    }

    // 최후 폴백: 공유 클라이언트에 세션 주입.
    // 이 경로는 SIGNED_IN 방송이 나가 site.js의 /profile.html 리다이렉트와
    // 경합할 수 있으므로 호출 직후 즉시 이동한다(호출부 참조).
    if (client) {
      await client.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token
      });
    }
  }

  function koreanAuthError(error) {
    var raw = error && error.message ? String(error.message) : "";
    var lower = raw.toLowerCase();
    if (lower.indexOf("invalid login credentials") >= 0) {
      return "이메일 또는 비밀번호가 올바르지 않습니다.";
    }
    if (lower.indexOf("email not confirmed") >= 0) {
      return "이메일 인증이 아직 완료되지 않았어요. 메일함에서 인증을 마친 뒤 로그인해 주세요.";
    }
    if (lower.indexOf("too many") >= 0 || lower.indexOf("rate limit") >= 0) {
      return "시도가 너무 많았어요. 잠시 후 다시 시도해 주세요.";
    }
    if (lower.indexOf("failed to fetch") >= 0 || lower.indexOf("network") >= 0) {
      return "네트워크 연결을 확인한 뒤 다시 시도해 주세요.";
    }
    return "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.";
  }
})();
