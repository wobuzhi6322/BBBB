const state = {
  config: null,
  release: null,
  supabase: null,
  session: null,
  theme: "dark"
};

const themeStorageKey = "bbbb-site-theme";

const els = {
  siteStatus: document.getElementById("site-status"),
  releaseStatus: document.getElementById("release-status"),
  releaseName: document.getElementById("release-name"),
  releaseMeta: document.getElementById("release-meta"),
  releaseNotes: document.getElementById("release-notes"),
  releaseLink: document.getElementById("release-link"),
  downloadButton: document.getElementById("download-button"),
  loginForm: document.getElementById("login-form"),
  signupButton: document.getElementById("signup-button"),
  logoutButton: document.getElementById("logout-button"),
  authMessage: document.getElementById("auth-message"),
  email: document.getElementById("email"),
  password: document.getElementById("password"),
  themeToggle: document.getElementById("theme-toggle"),
  dashboardMessage: document.getElementById("dashboard-message"),
  dashboardContent: document.getElementById("dashboard-content"),
  userEmail: document.getElementById("user-email")
};

init().catch((error) => {
  setText(els.siteStatus, `사이트 초기화 실패: ${error.message}`);
});

async function init() {
  setupTheme();
  if (!els.downloadButton || !els.releaseStatus) {
    return;
  }
  await loadConfig();
  await loadRelease();
  setupDownload();
  setupAuth();
}

function setupTheme() {
  const savedTheme = localStorage.getItem(themeStorageKey);
  applyTheme(savedTheme === "light" ? "light" : "dark");
  els.themeToggle?.addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });
}

function applyTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.dataset.theme = state.theme;
  localStorage.setItem(themeStorageKey, state.theme);
  if (els.themeToggle) {
    const isDark = state.theme === "dark";
    setText(els.themeToggle, isDark ? "화이트 모드" : "다크 모드");
    els.themeToggle.setAttribute("aria-pressed", String(isDark));
    els.themeToggle.setAttribute("title", isDark ? "화이트 모드로 전환" : "다크 모드로 전환");
  }
}

async function loadConfig() {
  const result = await getJson("/api/site-config");
  state.config = result.data;
  if (state.config.supabase.enabled) {
    setText(els.siteStatus, "계정 로그인 기능이 준비되어 있습니다.");
  } else {
    setText(els.siteStatus, "계정 로그인 기능을 준비 중입니다.");
  }
}

async function loadRelease() {
  try {
    const result = await getJson("/api/releases");
    state.release = result.data.release;
    const releasesUrl = result.data.releasesUrl || "#";
    if (els.releaseLink) {
      els.releaseLink.href = releasesUrl;
    }

    if (!state.release) {
      setText(els.releaseStatus, "아직 등록된 최신 버전이 없습니다.");
      setText(els.releaseName, "버전 없음");
      setText(els.releaseMeta, "배포 파일이 등록되면 다운로드 버튼이 활성화됩니다.");
      els.downloadButton.disabled = false;
      setText(els.downloadButton, "버전 정보 열기");
      return;
    }

    const asset = state.release.downloadAsset;
    const published = state.release.publishedAt ? formatDate(state.release.publishedAt) : "게시일 없음";
    setText(els.releaseStatus, `${state.release.tagName} 다운로드 준비됨`);
    setText(els.releaseName, state.release.name);
    setText(
      els.releaseMeta,
      asset
        ? `${published} · ${asset.name} · ${formatBytes(asset.size)}`
        : `${published} · ZIP 다운로드로 연결`
    );
    if (els.releaseLink) {
      els.releaseLink.href = state.release.htmlUrl;
    }
    els.downloadButton.disabled = false;
    setText(els.downloadButton, "Windows용 다운로드");

    if (els.releaseNotes) {
      els.releaseNotes.classList.remove("is-visible");
      setText(els.releaseNotes, "");
    }
  } catch (error) {
    setText(els.releaseStatus, "최신 버전 확인에 실패했습니다.");
    setText(els.releaseName, "확인 실패");
    setText(els.releaseMeta, "잠시 후 다시 확인해 주세요.");
  }
}

function setupDownload() {
  els.downloadButton.addEventListener("click", () => {
    const release = state.release;
    const url = release?.downloadUrl || state.config?.github?.releasesUrl || "#";
    if (release) {
      void logDownload(release);
    }
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

function setupAuth() {
  if (!els.loginForm || !els.authMessage) {
    return;
  }
  if (!state.config?.supabase?.enabled || !window.supabase?.createClient) {
    setText(els.authMessage, "현재 계정 로그인 기능을 준비 중입니다.");
    return;
  }

  state.supabase = window.supabase.createClient(state.config.supabase.url, state.config.supabase.anonKey);
  state.supabase.auth.getSession().then(({ data }) => {
    state.session = data.session;
    renderSession();
  });
  state.supabase.auth.onAuthStateChange((_event, session) => {
    state.session = session;
    renderSession();
  });

  els.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await signIn();
  });
  els.signupButton?.addEventListener("click", signUp);
  els.logoutButton?.addEventListener("click", signOut);
}

async function signIn() {
  setText(els.authMessage, "로그인 중입니다.");
  const { error } = await state.supabase.auth.signInWithPassword({
    email: els.email.value.trim(),
    password: els.password.value
  });
  setText(els.authMessage, error ? error.message : "로그인되었습니다.");
}

async function signUp() {
  setText(els.authMessage, "회원가입 중입니다.");
  const { error } = await state.supabase.auth.signUp({
    email: els.email.value.trim(),
    password: els.password.value
  });
  setText(els.authMessage, error ? error.message : "회원가입 요청이 완료되었습니다. 메일 인증이 필요할 수 있습니다.");
}

async function signOut() {
  await state.supabase.auth.signOut();
  setText(els.authMessage, "로그아웃되었습니다.");
}

function renderSession() {
  const user = state.session?.user;
  if (!user) {
    els.dashboardContent?.classList.add("is-hidden");
    setText(els.dashboardMessage, "로그인하면 계정별 다운로드와 공유 코드 상태를 여기에서 관리합니다.");
    return;
  }
  els.dashboardContent?.classList.remove("is-hidden");
  setText(els.dashboardMessage, "로그인된 계정 기준으로 다운로드와 공유 코드 관리 기능을 제공합니다.");
  setText(els.userEmail, user.email || user.id);
}

async function logDownload(release) {
  const token = state.session?.access_token;
  const asset = release.downloadAsset || {};
  try {
    await fetch("/api/download-events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({
        releaseTag: release.tagName,
        assetName: asset.name || "source-zip",
        assetUrl: release.downloadUrl
      })
    });
  } catch {
    // Download logging should never block the user.
  }
}

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function setText(element, value) {
  if (element) {
    element.textContent = value;
  }
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric"
  }).format(new Date(value));
}

function formatBytes(size) {
  if (!Number.isFinite(size) || size <= 0) {
    return "크기 정보 없음";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
