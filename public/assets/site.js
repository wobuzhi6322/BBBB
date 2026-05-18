const state = {
  config: null,
  release: null,
  supabase: null,
  session: null,
  account: null,
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
  headerAccount: document.getElementById("header-account"),
  navAccount: document.getElementById("nav-account"),
  loginDialog: document.getElementById("login-dialog"),
  dashboardMessage: document.getElementById("dashboard-message"),
  profileSection: document.getElementById("profile"),
  dashboardContent: document.getElementById("dashboard-content"),
  profileCard: document.getElementById("profile-card"),
  profileInitial: document.getElementById("profile-initial"),
  userEmail: document.getElementById("user-email"),
  accountRole: document.getElementById("account-role"),
  licensePlan: document.getElementById("license-plan"),
  licenseStatus: document.getElementById("license-status"),
  licenseCode: document.getElementById("license-code"),
  licenseLimits: document.getElementById("license-limits"),
  sharedCodeList: document.getElementById("shared-code-list"),
  deviceList: document.getElementById("device-list"),
  downloadList: document.getElementById("download-list"),
  adminLicensePanel: document.getElementById("admin-license-panel"),
  adminLicenseForm: document.getElementById("admin-license-form"),
  adminLicenseEmail: document.getElementById("admin-license-email"),
  adminLicensePlan: document.getElementById("admin-license-plan"),
  adminLicenseStatus: document.getElementById("admin-license-status"),
  adminLicenseExpires: document.getElementById("admin-license-expires"),
  adminLicenseNotes: document.getElementById("admin-license-notes"),
  adminLicenseMessage: document.getElementById("admin-license-message"),
  adminLicenseResult: document.getElementById("admin-license-result")
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
  setupLoginDialog();
  setupAdminLicenseForm();
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
  if (!els.themeToggle) {
    return;
  }
  const isDark = state.theme === "dark";
  els.themeToggle.setAttribute("aria-pressed", String(isDark));
  els.themeToggle.setAttribute("title", isDark ? "화이트 모드로 전환" : "다크 모드로 전환");
  els.themeToggle.setAttribute("aria-label", isDark ? "화이트 모드로 전환" : "다크 모드로 전환");
}

async function loadConfig() {
  const result = await getJson("/api/site-config");
  state.config = result.data;
  if (state.config.supabase.enabled) {
    setText(els.siteStatus, "계정 로그인 기능이 준비되어 있습니다.");
  } else {
    setText(els.siteStatus, "계정 로그인 기능은 준비 중입니다.");
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
      setText(els.downloadButton, "릴리즈 페이지 열기");
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
  } catch {
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

function setupLoginDialog() {
  els.headerAccount?.addEventListener("click", openAccountTarget);
  els.navAccount?.addEventListener("click", (event) => {
    if (state.session?.user) {
      return;
    }
    event.preventDefault();
    openLoginDialog();
  });
  document.querySelectorAll("[data-close-login]").forEach((button) => {
    button.addEventListener("click", closeLoginDialog);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeLoginDialog();
    }
  });
  window.addEventListener("hashchange", handleAccountHash);
  handleAccountHash();
}

function openAccountTarget(event) {
  event?.preventDefault();
  if (state.session?.user) {
    closeLoginDialog();
    els.profileSection?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  openLoginDialog();
}

function openLoginDialog() {
  els.loginDialog?.classList.remove("is-hidden");
  document.body.classList.add("has-modal");
  window.setTimeout(() => els.email?.focus(), 0);
}

function closeLoginDialog() {
  els.loginDialog?.classList.add("is-hidden");
  document.body.classList.remove("has-modal");
}

function handleAccountHash() {
  if (window.location.hash !== "#login") {
    return;
  }
  if (state.session?.user) {
    closeLoginDialog();
    window.setTimeout(() => els.profileSection?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
    return;
  }
  openLoginDialog();
}

function setupAuth() {
  if (!els.loginForm || !els.authMessage) {
    return;
  }
  if (!state.config?.supabase?.enabled || !window.supabase?.createClient) {
    setText(els.authMessage, "현재 계정 로그인 기능은 준비 중입니다.");
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

function setupAdminLicenseForm() {
  els.adminLicenseForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createAdminLicense();
  });
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
    els.profileSection?.classList.add("is-hidden");
    els.profileCard?.classList.remove("is-hidden");
    els.dashboardContent?.classList.remove("is-hidden");
    setText(els.headerAccount, "로그인");
    if (els.navAccount) {
      els.navAccount.href = "#login";
    }
    state.account = null;
    setText(els.dashboardMessage, "계정의 라이선스, 사용 제한, 공유 코드, 등록 PC를 확인합니다.");
    clearAccountDashboard();
    return;
  }
  const wasDialogOpen = Boolean(els.loginDialog && !els.loginDialog.classList.contains("is-hidden"));
  els.profileSection?.classList.remove("is-hidden");
  els.profileCard?.classList.remove("is-hidden");
  els.dashboardContent?.classList.remove("is-hidden");
  setText(els.headerAccount, "내 프로필");
  if (els.navAccount) {
    els.navAccount.href = "#profile";
  }
  setText(els.dashboardMessage, "계정의 라이선스, 사용 제한, 공유 코드, 등록 PC를 확인합니다.");
  setText(els.userEmail, user.email || user.id);
  setText(els.profileInitial, getProfileInitial(user.email || user.id));
  closeLoginDialog();
  if (wasDialogOpen) {
    window.setTimeout(() => els.profileSection?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }
  void loadAccount();
}

async function loadAccount() {
  const token = state.session?.access_token;
  if (!token) {
    return;
  }
  try {
    const result = await getJsonWithAuth("/api/account", token);
    state.account = result.data;
    renderAccount(result.data);
  } catch (error) {
    setText(els.licensePlan, "확인 실패");
    setText(els.licenseStatus, error instanceof Error ? error.message : "계정 정보를 불러오지 못했습니다.");
  }
}

function renderAccount(account) {
  const profile = account.profile || {};
  const license = account.activeLicense;
  setText(els.accountRole, `역할: ${roleLabel(profile.role)}`);
  els.adminLicensePanel?.classList.toggle("is-hidden", profile.role !== "admin");

  if (!license) {
    setText(els.licensePlan, "플랜 없음");
    setText(els.licenseStatus, "관리자가 요금제를 부여하면 라이선스가 표시됩니다.");
    setText(els.licenseCode, "발급 대기");
    replaceRows(els.licenseLimits, [row("상태", "구매 확인 대기")]);
  } else {
    setText(els.licensePlan, planLabel(license.plan));
    setText(els.licenseStatus, `${statusLabel(license.status)} · ${license.expires_at ? `${formatDate(license.expires_at)}까지` : "만료일 없음"}`);
    setText(els.licenseCode, license.license_code || "-");
    replaceRows(els.licenseLimits, [
      row("시그니처", `${license.max_signatures}개`),
      row("미디어", `${license.max_media_mb}MB`),
      row("등록 PC", `${license.max_devices}대`),
      row("공유 코드", license.shared_sync_enabled ? "사용 가능" : "미포함")
    ]);
  }

  replaceRows(
    els.sharedCodeList,
    account.sharedCodes?.length
      ? account.sharedCodes.map((item) => row(item.code, sharedRoleLabel(item.role)))
      : [emptyRow("아직 연결된 공유 코드가 없습니다.")]
  );

  replaceRows(
    els.deviceList,
    account.devices?.length
      ? account.devices.map((item) => row(item.device_name || "이름 없는 PC", item.app_version || formatDate(item.last_seen_at)))
      : [emptyRow("아직 등록된 PC가 없습니다.")]
  );

  replaceRows(
    els.downloadList,
    account.downloads?.length
      ? account.downloads.map((item) => row(item.release_tag, formatDate(item.created_at)))
      : [emptyRow("다운로드 기록이 없습니다.")]
  );
}

function clearAccountDashboard() {
  setText(els.userEmail, "-");
  setText(els.profileInitial, "G");
  setText(els.accountRole, "");
  setText(els.licensePlan, "-");
  setText(els.licenseStatus, "");
  setText(els.licenseCode, "-");
  replaceRows(els.licenseLimits, []);
  replaceRows(els.sharedCodeList, []);
  replaceRows(els.deviceList, []);
  replaceRows(els.downloadList, []);
  els.adminLicensePanel?.classList.add("is-hidden");
  setText(els.adminLicenseMessage, "");
  replaceRows(els.adminLicenseResult, []);
}

async function createAdminLicense() {
  const token = state.session?.access_token;
  if (!token) {
    setText(els.adminLicenseMessage, "관리자 로그인이 필요합니다.");
    return;
  }

  const email = els.adminLicenseEmail?.value.trim();
  if (!email) {
    setText(els.adminLicenseMessage, "사용자 이메일을 입력해 주세요.");
    return;
  }

  setText(els.adminLicenseMessage, "라이선스를 발급하는 중입니다.");
  replaceRows(els.adminLicenseResult, []);

  try {
    const result = await postJsonWithAuth("/api/admin-license", token, {
      email,
      plan: els.adminLicensePlan?.value || "starter",
      status: els.adminLicenseStatus?.value || "active",
      expiresAt: els.adminLicenseExpires?.value || undefined,
      notes: els.adminLicenseNotes?.value.trim() || undefined
    });
    const license = result.data.license;
    setText(els.adminLicenseMessage, "라이선스가 발급되었습니다.");
    replaceRows(els.adminLicenseResult, [
      row("사용자", email),
      row("요금제", planLabel(license.plan)),
      row("상태", statusLabel(license.status)),
      row("라이선스 코드", license.license_code)
    ]);
    if (state.session?.user?.email?.toLowerCase() === email.toLowerCase()) {
      await loadAccount();
    }
  } catch (error) {
    setText(els.adminLicenseMessage, error instanceof Error ? error.message : "라이선스 발급에 실패했습니다.");
  }
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

async function getJsonWithAuth(url, token) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`
    }
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function postJsonWithAuth(url, token, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
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

function replaceRows(target, rows) {
  if (!target) {
    return;
  }
  target.replaceChildren(...rows);
}

function row(label, value) {
  const item = document.createElement("li");
  const labelEl = document.createElement("span");
  const valueEl = document.createElement("strong");
  labelEl.textContent = label;
  valueEl.textContent = value;
  item.append(labelEl, valueEl);
  return item;
}

function emptyRow(value) {
  const item = document.createElement("div");
  item.className = "account-empty";
  item.textContent = value;
  return item;
}

function roleLabel(value) {
  if (value === "admin") {
    return "관리자";
  }
  return "사용자";
}

function planLabel(value) {
  const labels = {
    starter: "Starter",
    standard: "Standard",
    pro: "Pro"
  };
  return labels[value] || "알 수 없음";
}

function statusLabel(value) {
  const labels = {
    pending: "대기",
    active: "활성",
    expired: "만료",
    suspended: "정지"
  };
  return labels[value] || "상태 확인 필요";
}

function sharedRoleLabel(value) {
  const labels = {
    owner: "소유자",
    editor: "편집자",
    viewer: "보기"
  };
  return labels[value] || "보기";
}

function getProfileInitial(value) {
  const trimmed = String(value || "G").trim();
  return (trimmed.charAt(0) || "G").toUpperCase();
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
