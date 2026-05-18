const state = {
  config: null,
  release: null,
  supabase: null,
  session: null
};

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
  dashboardMessage: document.getElementById("dashboard-message"),
  dashboardContent: document.getElementById("dashboard-content"),
  userEmail: document.getElementById("user-email")
};

init().catch((error) => {
  setText(els.siteStatus, `사이트 초기화 실패: ${error.message}`);
});

async function init() {
  await loadConfig();
  await loadRelease();
  setupDownload();
  setupAuth();
}

async function loadConfig() {
  const result = await getJson("/api/site-config");
  state.config = result.data;
  if (state.config.supabase.enabled) {
    setText(els.siteStatus, "Supabase 로그인이 연결되어 있습니다.");
  } else {
    setText(els.siteStatus, "Supabase 공개 키 환경변수 추가가 필요합니다.");
  }
}

async function loadRelease() {
  try {
    const result = await getJson("/api/releases");
    state.release = result.data.release;
    const releasesUrl = result.data.releasesUrl || state.config?.github?.releasesUrl || "#";
    els.releaseLink.href = releasesUrl;

    if (!state.release) {
      setText(els.releaseStatus, result.data.message || "아직 등록된 Release가 없습니다.");
      setText(els.releaseName, "Release 없음");
      setText(els.releaseMeta, "GitHub Release에 ZIP 파일을 올리면 다운로드 버튼이 활성화됩니다.");
      els.downloadButton.disabled = false;
      setText(els.downloadButton, "GitHub Release 열기");
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
        : `${published} · ZIP 소스 다운로드로 연결`
    );
    els.releaseLink.href = state.release.htmlUrl;
    els.downloadButton.disabled = false;
    setText(els.downloadButton, "Windows용 다운로드");

    if (state.release.body) {
      els.releaseNotes.classList.add("is-visible");
      setText(els.releaseNotes, state.release.body);
    }
  } catch (error) {
    setText(els.releaseStatus, `Release 확인 실패: ${error.message}`);
    setText(els.releaseName, "확인 실패");
    setText(els.releaseMeta, "GitHub 저장소 또는 네트워크 상태를 확인해야 합니다.");
  }
}

function setupDownload() {
  els.downloadButton.addEventListener("click", async () => {
    const release = state.release;
    const url = release?.downloadUrl || state.config?.github?.releasesUrl || "https://github.com/wobuzhi6322/BBBB/releases";
    if (release) {
      void logDownload(release);
    }
    window.open(url, "_blank", "noopener,noreferrer");
  });
}

function setupAuth() {
  if (!state.config?.supabase?.enabled || !window.supabase?.createClient) {
    setText(els.authMessage, "Vercel 환경변수에 SUPABASE_ANON_KEY를 추가하면 로그인 기능이 켜집니다.");
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
  els.signupButton.addEventListener("click", signUp);
  els.logoutButton.addEventListener("click", signOut);
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
    els.dashboardContent.classList.add("is-hidden");
    setText(els.dashboardMessage, "로그인하면 계정별 다운로드와 공유 코드 상태를 여기에서 관리합니다.");
    return;
  }
  els.dashboardContent.classList.remove("is-hidden");
  setText(els.dashboardMessage, "로그인된 계정 기준으로 다운로드와 공유 코드 관리 기능을 확장할 수 있습니다.");
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
